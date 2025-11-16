import express from 'express'
import pool from '../database/db.js'
import bcrypt from 'bcryptjs'
import { sendSMS } from '../services/smsService.js'

const router = express.Router()

/**
 * Helper: update clearance row for a particular department.
 * Validates department, updates status/reason/timestamp, then updates requests.status if needed.
 */
async function updateClearanceRow(requestId, department, status, reason) {
  const validDepartments = [
    "registrar", "guidance", "engineering",
    "criminology", "mis", "library", "cashier"
  ]
  if (!validDepartments.includes(department)) {
    const err = new Error("Invalid department")
    err.code = "INVALID_DEPARTMENT"
    throw err
  }

  const approvedAtField = `${department}_approved_at`
  const statusField = `${department}_status`
  const reasonField = `${department}_reason`

  let query, params
  if (status === "approved") {
    query = `UPDATE request_clearances
             SET ${statusField} = ?, ${reasonField} = NULL, ${approvedAtField} = NOW()
             WHERE request_id = ?`
    params = [status, requestId]
  } else if (status === "rejected" && reason) {
    query = `UPDATE request_clearances
             SET ${statusField} = ?, ${reasonField} = ?, ${approvedAtField} = NULL
             WHERE request_id = ?`
    params = [status, reason, requestId]
  } else {
    query = `UPDATE request_clearances
             SET ${statusField} = ?, ${approvedAtField} = NULL
             WHERE request_id = ?`
    params = [status, requestId]
  }

  const [result] = await pool.query(query, params)
  if (result.affectedRows === 0) {
    // If there's no clearance row yet, create it then retry the update
    const [exists] = await pool.query("SELECT 1 FROM request_clearances WHERE request_id = ?", [requestId])
    if (exists.length === 0) {
      await pool.query("INSERT INTO request_clearances (request_id) VALUES (?)", [requestId])
      const [retry] = await pool.query(query, params)
      if (retry.affectedRows === 0) {
        throw new Error("Failed to update clearance after creating row")
      }
    } else {
      throw new Error("Failed to update clearance")
    }
  }

  // After updating, check overall clearance statuses to set request.status
  const [clearanceStatusRows] = await pool.query(
    `SELECT registrar_status, guidance_status, engineering_status,
            criminology_status, mis_status, library_status, cashier_status
     FROM request_clearances
     WHERE request_id = ?`,
    [requestId]
  )

  if (clearanceStatusRows.length > 0) {
    const statuses = Object.values(clearanceStatusRows[0]).map(s => (s || "").toLowerCase())
    const anyRejected = statuses.some(s => s === 'rejected')
    const allApproved = statuses.every(s => s === 'approved')

    if (anyRejected) {
      await pool.query("UPDATE requests SET status = 'rejected' WHERE request_id = ?", [requestId])
    } else if (allApproved) {
      await pool.query("UPDATE requests SET status = 'approved' WHERE request_id = ?", [requestId])
    } else {
      // optional: keep as is (pending/in-progress)
    }
  }

  return true
}

/* ==========================
   Reject request (mark request rejected + reason)
   ========================== */
router.post('/reject-req/:request_id', async (req, res) => {
  const { request_id } = req.params
  const { reason } = req.body
  
  try {
    // Get request details and student info for SMS
    const [requestData] = await pool.query(
      `SELECT r.*, u.phone, u.username, d.name as document_name
       FROM requests r 
       JOIN user u ON r.student_id = u.uid 
       LEFT JOIN document_types d ON r.document_id = d.document_id
       WHERE r.request_id = ?`,
      [request_id]
    )

    if (requestData.length === 0) {
      return res.status(404).json({ error: "Request not found" })
    }

    const request = requestData[0]

    // Update request with rejection reason
    const [result] = await pool.query(
      "UPDATE requests SET request_rejection = ?, status = 'rejected' WHERE request_id = ?",
      [reason, request_id]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Request not found" })
    }

    // Send SMS notification with rejection reason
    if (request.phone) {
      const smsMessage = `Hi ${request.username}, your document request #${request_id} for "${request.document_name}" has been rejected. Reason: ${reason}. Please contact BHC registrar for assistance.`
      
      await sendSMS(request.phone, smsMessage).catch(err => {
        console.error("SMS sending failed:", err);
        // Don't fail the request if SMS fails
      });
      console.log(`✅ Request rejection SMS sent to ${request.phone}`);
    }

    res.json({ 
      message: "Request rejected successfully", 
      requestId: request_id, 
      reason,
      smsSent: !!request.phone 
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Internal server error" })
  }
})

/* ==========================
   Create request
   - Inserts into requests, then auto-creates request_clearances record
   ========================== */
// UPDATE /create-request to insert into request_documents junction table
router.post("/create-request", async (req, res) => {
  try {
    const { student_id, document_id, request_reason, amount } = req.body;

    if (!student_id || !document_id || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const [existing] = await pool.query(
      "SELECT * FROM requests WHERE document_id = ? AND student_id = ?",
      [document_id, student_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: "You already requested this document." });
    }

    const [docs] = await pool.query(
      "SELECT processing_time FROM document_types WHERE document_id = ?",
      [document_id]
    );

    if (docs.length === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    let daysToAdd = 0;
    const match = docs[0].processing_time && docs[0].processing_time.match(/\d+/);
    if (match) daysToAdd = parseInt(match[0], 10);

    const submissionDate = new Date();
    const releaseDate = new Date(submissionDate);
    releaseDate.setDate(submissionDate.getDate() + daysToAdd);
    const formattedReleaseDate = releaseDate.toISOString().split("T")[0];

    // ⭐ Insert with AMOUNT
    const [result] = await pool.query(
      `INSERT INTO requests 
      (student_id, document_id, submission_date, release_date, status, payment, reason, amount) 
      VALUES (?, ?, NOW(), ?, 'Pending', 'pending', ?, ?)`,
      [student_id, document_id, formattedReleaseDate, request_reason, amount]
    );

    const requestId = result.insertId;

    await pool.query(
      "INSERT INTO request_documents (request_id, document_id) VALUES (?, ?)",
      [requestId, document_id]
    );

    await pool.query("INSERT INTO request_clearances (request_id) VALUES (?)", [requestId]);

    res.status(201).json({
      message: "Request created successfully",
      requestId,
      release_date: formattedReleaseDate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ==========================
   Approve payment
   ========================== */
router.put("/approve-payment/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;

    // Get request and user info for SMS
    const [requestData] = await pool.query(
      `SELECT r.*, u.phone, u.username 
       FROM requests r 
       JOIN user u ON r.student_id = u.uid 
       WHERE r.request_id = ?`,
      [request_id]
    );

    if (requestData.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = requestData[0];

    // Update payment status
    const [result] = await pool.query(
      `UPDATE requests SET payment = 'approved', status = 'in progress' 
       WHERE request_id = ?`,
      [request_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Send SMS notification
    if (request.phone) {
      const smsMessage = `Hi ${request.username}, your payment for request #${request_id} has been approved by BHC Cashier. Your clearance process can now proceed.`;
      await sendSMS(request.phone, smsMessage).catch(err => {
        console.error("SMS sending failed:", err);
        // Don't fail the request if SMS fails
      });
      console.log(`✅ Payment approval SMS sent to ${request.phone}`);
    }

    res.json({ 
      message: "Payment approved for all documents in this request",
      smsSent: !!request.phone 
    });

  } catch (error) {
    console.error("Approve payment error:", error);
    res.status(500).json({
      message: "Failed to approve payment",
      details: error.message
    });
  }
});

/* ==========================
   Reject payment
   ========================== */
router.put("/reject-payment/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    // Get request and user info for SMS
    const [requestData] = await pool.query(
      `SELECT r.*, u.phone, u.username 
       FROM requests r 
       JOIN user u ON r.student_id = u.uid 
       WHERE r.request_id = ?`,
      [request_id]
    );

    if (requestData.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = requestData[0];

    // Update payment status
    const [result] = await pool.query(
      `UPDATE requests 
       SET payment = 'rejected', rejection_reason = ?
       WHERE request_id = ?`,
      [reason || null, request_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Send SMS notification
    if (request.phone) {
      const smsMessage = `Hi ${request.username}, your payment for request #${request_id} was rejected. Reason: ${reason}. Please contact BHC Cashier for assistance.`;
      await sendSMS(request.phone, smsMessage).catch(err => {
        console.error("SMS sending failed:", err);
        // Don't fail the request if SMS fails
      });
      console.log(`✅ Payment rejection SMS sent to ${request.phone}`);
    }

    res.json({ 
      message: "Payment rejected",
      smsSent: !!request.phone 
    });

  } catch (error) {
    console.error("Reject payment error:", error);
    res.status(500).json({
      message: "Failed to reject payment",
      details: error.message
    });
  }
});

router.post("/api/check-clearance-completion/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    
    console.log("=== CHECKING CLEARANCE COMPLETION ===");
    console.log("Student ID:", studentId);
    
    // Get student clearance data with user info
    const [clearanceData] = await pool.query(
      `SELECT sc.*, u.phone, u.username, u.course, u.role, u.email
       FROM student_clearance sc
       JOIN user u ON sc.student_id = u.uid
       WHERE sc.student_id = ?`,
      [studentId]
    );

    if (clearanceData.length === 0) {
      return res.status(404).json({ message: "Clearance not found" });
    }

    const clearance = clearanceData[0];
    const courseLower = (clearance.course || "").toLowerCase().trim();
    const studentRole = (clearance.role || "").toLowerCase();

    console.log("Student role:", studentRole);
    console.log("Student course:", courseLower);

    // Alumni only need registrar and cashier
    if (studentRole === "alumni") {
      console.log("Checking alumni clearance...");
      const alumniComplete = 
        clearance.registrar_status === "approved" && 
        clearance.cashier_status === "approved";

      console.log("Registrar:", clearance.registrar_status);
      console.log("Cashier:", clearance.cashier_status);
      console.log("Alumni complete:", alumniComplete);

      if (alumniComplete && clearance.phone) {
        // Check if we've already sent notification
        const [notifCheck] = await pool.query(
          "SELECT * FROM clearance_notifications WHERE student_id = ? AND notification_type = 'clearance_complete'",
          [studentId]
        );

        if (notifCheck.length === 0) {
          const smsMessage = `Hi ${clearance.username}, congratulations! Your BHC clearance is now complete. You may now proceed with your document request.`;
          await sendSMS(clearance.phone, smsMessage).catch(err => {
            console.error("SMS sending failed:", err);
          });
          
          // Record notification sent
          await pool.query(
            "INSERT INTO clearance_notifications (student_id, notification_type, sent_at) VALUES (?, 'clearance_complete', NOW())",
            [studentId]
          );
          
          console.log(`✅ Alumni clearance completion SMS sent to ${clearance.phone}`);
          return res.status(200).json({ 
            message: "Clearance complete notification sent",
            allApproved: true,
            smsSent: true 
          });
        } else {
          console.log("SMS already sent previously");
        }
      }

      return res.status(200).json({ 
        allApproved: alumniComplete,
        smsSent: false 
      });
    }

    // Regular students - check all required departments based on course
    const misCourses = [
      "bachelor of science in accountancy",
      "bachelor of science in accounting technology",
      "bachelor of science in entrepreneurship",
      "bachelor of science in information technology",
      "bachelor of science in computer engineering",
    ];
    
    const engineeringCourses = [
      "bachelor of science in architecture",
      "bachelor of science in civil engineering",
      "bachelor of science in electronics engineering",
      "bachelor of science in electrical engineering",
      "bachelor of science in mechanical engineering",
    ];
    
    const criminologyCourses = [
      "bachelor of science in criminology",
    ];

    // Base departments for all students
    const baseDepts = ["registrar", "guidance", "library", "cashier"];
    let allApproved = baseDepts.every(dept => {
      const status = clearance[`${dept}_status`];
      console.log(`  ${dept}_status: ${status}`);
      return status === "approved";
    });

    console.log("Base departments approved:", allApproved);

    // Check program head clearance
    if (allApproved) {
      if (misCourses.includes(courseLower)) {
        console.log("Checking MIS clearance...");
        allApproved = clearance.mis_status === "approved";
        console.log("  mis_status:", clearance.mis_status);
      } else if (engineeringCourses.includes(courseLower)) {
        console.log("Checking Engineering clearance...");
        allApproved = clearance.engineering_status === "approved";
        console.log("  engineering_status:", clearance.engineering_status);
      } else if (criminologyCourses.includes(courseLower)) {
        console.log("Checking Criminology clearance...");
        allApproved = clearance.criminology_status === "approved";
        console.log("  criminology_status:", clearance.criminology_status);
      }
    }

    console.log("All required departments approved:", allApproved);

    // If all approved and phone exists, send SMS
    if (allApproved && clearance.phone) {
      // Check if we've already sent notification
      const [notifCheck] = await pool.query(
        "SELECT * FROM clearance_notifications WHERE student_id = ? AND notification_type = 'clearance_complete'",
        [studentId]
      );

      if (notifCheck.length === 0) {
        const smsMessage = `Hi ${clearance.username}, congratulations! Your BHC clearance is now complete. You may now proceed with your document request.`;
        await sendSMS(clearance.phone, smsMessage).catch(err => {
          console.error("SMS sending failed:", err);
        });
        
        // Record notification sent
        await pool.query(
          "INSERT INTO clearance_notifications (student_id, notification_type, sent_at) VALUES (?, 'clearance_complete', NOW())",
          [studentId]
        );
        
        console.log(`✅ Clearance completion SMS sent to ${clearance.phone}`);
        return res.status(200).json({ 
          message: "Clearance complete notification sent",
          allApproved: true,
          smsSent: true 
        });
      } else {
        console.log("SMS already sent previously");
      }
    }

    return res.status(200).json({ 
      allApproved,
      smsSent: false 
    });

  } catch (error) {
    console.error("Error checking clearance completion:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      details: error.message 
    });
  }
});

/* ==========================
   Get a single clearance (detailed) — merges request + clearance + student info
   ========================== */
router.get("/api/clearances/:requestId", async (req, res) => {
  const { requestId } = req.params
  console.log(`Fetching clearance for request_id: ${requestId}`)
  
  try {
    const [requestRows] = await pool.query(
      `SELECT 
        r.request_id,
        r.student_id,
        r.document_id,
        r.payment,
        r.status,
        r.release_date,
        r.submission_date,
        r.reason,
        r.payment_attachment,
        r.reference_no,
        r.amount,
        r.rejection_reason,
        r.request_rejection,
        d.name AS document_name,
        u.uid,
        u.username,
        u.email,
        u.course,
        u.student_number
       FROM requests r
       LEFT JOIN document_types d ON r.document_id = d.document_id
       LEFT JOIN \`user\` u ON r.student_id = u.uid
       WHERE r.request_id = ?`,
      [requestId]
    )

    if (requestRows.length === 0) {
      console.log(`Request ${requestId} not found`)
      return res.status(404).json({ message: "Request not found" })
    }

    const request = requestRows[0]

    // Try to get clearance data (may not exist yet)
    const [clearanceRows] = await pool.query(
      `SELECT * FROM request_clearances WHERE request_id = ?`,
      [requestId]
    )

    let clearanceData = {}
    if (clearanceRows.length > 0) {
      clearanceData = clearanceRows[0]
    } else {
      // No clearance yet - create one
      console.log(`No clearance found for request ${requestId}, creating one...`)
      await pool.query(
        "INSERT INTO request_clearances (request_id) VALUES (?)",
        [requestId]
      )
      // Provide default values so frontend doesn't break
      clearanceData = {
        registrar_status: 'pending',
        guidance_status: 'pending',
        engineering_status: 'pending',
        criminology_status: 'pending',
        mis_status: 'pending',
        library_status: 'pending',
        cashier_status: 'pending'
      }
    }

    // Merge everything together and keep both status keys for compatibility:
    // - `status` (original request.status) and `request_status` for any code that expects that alias.
    const response = {
      ...request,
      request_status: request.status,
      ...clearanceData
    }

    console.log(`Successfully fetched clearance for request ${requestId}`)
    res.json(response)
    
  } catch (err) {
    console.error("Error fetching clearance:", err.message)
    console.error("Full error:", err)
    res.status(500).json({ 
      error: "Internal server error", 
      details: err.message,
      sql: err.sql 
    })
  }
})

/* ==========================
   Update clearance for a department (main route)
   - Expects :department in path and { status, reason } in body
   ========================== */
router.put("/api/clearances/:requestId/:department", async (req, res) => {
  const { requestId, department } = req.params
  const { status, reason } = req.body

  const validDepartments = [
    "registrar", "guidance", "engineering", 
    "criminology", "mis", "library", "cashier"
  ]

  if (!validDepartments.includes(department)) {
    return res.status(400).json({ message: "Invalid department" })
  }

  try {
    // Ensure a clearance row exists
    const [existing] = await pool.query(
      "SELECT * FROM request_clearances WHERE request_id = ?",
      [requestId]
    )

    if (existing.length === 0) {
      await pool.query(
        "INSERT INTO request_clearances (request_id) VALUES (?)",
        [requestId]
      )
      console.log(`Created new clearance record for request ${requestId}`)
    }

    // Use helper to update and set timestamps appropriately
    await updateClearanceRow(requestId, department, status, reason)

    res.json({ 
      message: `${department} clearance updated successfully`, 
      status, 
      reason: reason || null 
    })
  } catch (err) {
    if (err.code === "INVALID_DEPARTMENT") {
      return res.status(400).json({ message: "Invalid department" })
    }
    console.error("Error updating clearance:", err)
    res.status(500).json({ error: "Internal server error", details: err.message })
  }
})

/* ==========================
   Bridge routes: approve/reject helpers (convenience for some frontends)
   These call the same helper above for consistency.
   Request body must contain { department } or { department, reason }
   ========================== */
router.put("/api/clearances/:requestId/approve", async (req, res) => {
  const { requestId } = req.params
  const { department } = req.body
  try {
    if (!department) return res.status(400).json({ message: "Missing department in body" })
    await updateClearanceRow(requestId, department, "approved", null)
    res.json({ message: `${department} approved successfully` })
  } catch (err) {
    console.error("Approve error:", err)
    res.status(500).json({ error: "Failed to approve", details: err.message })
  }
})

router.put("/api/clearances/:requestId/reject", async (req, res) => {
  const { requestId } = req.params
  const { department, reason } = req.body
  try {
    if (!department) return res.status(400).json({ message: "Missing department in body" })
    if (!reason) return res.status(400).json({ message: "Missing reason for rejection" })
    await updateClearanceRow(requestId, department, "rejected", reason)
    res.json({ message: `${department} rejected successfully` })
  } catch (err) {
    console.error("Reject error:", err)
    res.status(500).json({ error: "Failed to reject", details: err.message })
  }
})

router.put("/api/clearances/:userId/cashier", async (req, res) => {
  const { userId } = req.params
  const { status } = req.body

  try {
    // Update as cashier on request_clearances (userId here is treated as request_id historically)
    const [result] = await pool.query(
      `UPDATE request_clearances SET cashier_status = ? WHERE request_id = ?`,
      [status, userId]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Clearance not found" })
    }

    // After update, re-run overall status checks (to keep requests.status in sync)
    await updateClearanceRow(userId, 'cashier', status, null)

    res.json({ message: "Cashier clearance updated" })
  } catch (err) {
    console.error("Error updating clearance:", err.message)
    res.status(500).json({ error: "Internal server error" })
  }
})

/* ==========================
   Get requests for a student
   ========================== */
router.get("/requests/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const [requests] = await pool.query(
      `
      SELECT 
          r.request_id,
          r.student_id,
          r.document_id,
          r.amount,                     -- ⭐ FIX: amount explicitly included
          r.payment,
          r.status,
          r.completed_at,
          r.release_date,
          r.submission_date,
          r.reason,
          r.payment_attachment,
          r.reference_no,
          r.rejection_reason,
          r.request_rejection,
          r.document_ids,

          CASE 
              WHEN COUNT(rd.document_id) > 0 THEN GROUP_CONCAT(dt.name SEPARATOR ', ')
              ELSE dt_single.name
          END AS document_name,

          COALESCE(COUNT(DISTINCT rd.document_id), 1) AS document_count

      FROM requests r
      LEFT JOIN request_documents rd ON r.request_id = rd.request_id
      LEFT JOIN document_types dt ON rd.document_id = dt.document_id
      LEFT JOIN document_types dt_single ON r.document_id = dt_single.document_id

      WHERE r.student_id = ?
      GROUP BY r.request_id         -- ⭐ FIX: remove dt_single.name
      ORDER BY r.submission_date DESC
      `,
      [user_id]
    );

    res.json({ requests });

  } catch (error) {
    console.error("Fetch requests error:", error);
    res.status(500).json({
      message: "Failed to fetch requests",
      details: error.message
    });
  }
});


/* ==========================
   Get all requests (admin)
   ========================== */
router.get("/get-all-requests", async (req, res) => {
  try {
    const [requests] = await pool.query(
      `SELECT r.request_id, r.student_id, r.document_id, r.status, r.payment,
        DATE_FORMAT(r.submission_date, '%Y-%m-%d') AS submission_date,
        DATE_FORMAT(r.release_date, '%Y-%m-%d') AS release_date,
        d.name AS document_name
      FROM requests r
      JOIN document_types d ON r.document_id = d.document_id
      WHERE 1
      ORDER BY r.submission_date DESC`
    )

    res.status(200).json({ requests })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

/* ==========================
   Get requests (joined) — this was causing your frontend change kept original field names
   so frontend doesn't break (status remains `status`, document_name, username present)
   ========================== */
router.get("/get-requests", async (req, res) => {
  try {
    const { role, department } = req.query; 

    let whereClause = "";
    const params = [];

    // Super Admin can see everything
    if (role !== "super admin") {
      if (department === "engineering") {
        whereClause = "WHERE LOWER(u.course) LIKE ?";
        params.push("%engineering%");
      } else if (department === "criminology") {
        whereClause = "WHERE LOWER(u.course) LIKE ?";
        params.push("%criminology%");
      } else if (department === "mis") {
        whereClause = `WHERE (
          LOWER(u.course) LIKE ? OR 
          LOWER(u.course) LIKE ? OR 
          LOWER(u.course) LIKE ? OR 
          LOWER(u.course) LIKE ? OR 
          LOWER(u.course) LIKE ?
        )`;
        params.push(
          "%information technology%",
          "%accountancy%",
          "%accounting technology%",
          "%entrepreneurship%",
          "%computer technology%"
        );
      } else if (department === "guidance" || department === "registrar" || department === "cashier" || department === "library") {
        whereClause = "";
      } else {
        whereClause = "";
      }
    }

    const [fetchRequests] = await pool.query(`
      SELECT 
        r.request_id,
        r.student_id,
        r.status,
        r.payment,
        r.payment_attachment,
        r.reference_no,
        r.rejection_reason,
        r.reason,
        r.amount,
        DATE_FORMAT(r.submission_date, '%Y-%m-%d') AS submission_date,
        DATE_FORMAT(r.release_date, '%Y-%m-%d') AS release_date,
        CASE 
          WHEN COUNT(rd.document_id) > 0 THEN GROUP_CONCAT(d.name SEPARATOR ', ')
          ELSE dt.name
        END AS document_name,
        COALESCE(COUNT(DISTINCT rd.document_id), 1) AS document_count,
        u.username,
        u.course,
        u.email,
        c.registrar_status,
        c.guidance_status,
        c.engineering_status,
        c.criminology_status,
        c.mis_status,
        c.library_status,
        c.cashier_status
      FROM requests r
      INNER JOIN \`user\` u ON r.student_id = u.uid
      LEFT JOIN request_clearances c ON r.request_id = c.request_id
      LEFT JOIN request_documents rd ON r.request_id = rd.request_id
      LEFT JOIN document_types d ON rd.document_id = d.document_id
      LEFT JOIN document_types dt ON r.document_id = dt.document_id
      ${whereClause}
      GROUP BY r.request_id, u.username, u.course, u.email,
               c.registrar_status, c.guidance_status, c.engineering_status, 
               c.criminology_status, c.mis_status, c.library_status, c.cashier_status
      ORDER BY r.request_id DESC
    `, params);

    res.status(200).json({ fetchRequests });
  } catch (err) {
    console.error("Error fetching requests:", err);
    res.status(500).json({ error: "Failed to fetch requests", details: err.message });
  }
});

/* ==========================
   Request status update
   ========================== */
router.put("/request-status/:id", async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  try {
    // Get request details and student info for SMS
    const [requestData] = await pool.query(
      `SELECT r.*, u.phone, u.username, d.name as document_name
       FROM requests r 
       JOIN user u ON r.student_id = u.uid 
       LEFT JOIN document_types d ON r.document_id = d.document_id
       WHERE r.request_id = ?`,
      [id]
    )

    if (requestData.length === 0) {
      return res.status(404).json({ error: "Request not found" })
    }

    const request = requestData[0]

    // Update request status
    await pool.query("UPDATE requests SET status = ? WHERE request_id = ?", [status, id])

    // Send SMS notification based on status
    if (request.phone) {
      let smsMessage = ""
      
      if (status.toLowerCase() === "approved") {
        smsMessage = `Hi ${request.username}, your document request #${id} for "${request.document_name}" has been approved by BHC. You will be notified when it's ready for pickup.`
      } else if (status.toLowerCase() === "rejected") {
        smsMessage = `Hi ${request.username}, your document request #${id} for "${request.document_name}" has been rejected. Please contact the registrar's office for more information.`
      } else if (status.toLowerCase() === "ready for pickup" || status.toLowerCase() === "completed") {
        smsMessage = `Hi ${request.username}, your requested document "${request.document_name}" (Request #${id}) is now ready for pickup at BHC. Please bring a valid ID.`
      }

      if (smsMessage) {
        await sendSMS(request.phone, smsMessage).catch(err => {
          console.error("SMS sending failed:", err);
          // Don't fail the request if SMS fails
        });
        console.log(`✅ Request ${status} SMS sent to ${request.phone}`);
      }
    }

    res.json({ 
      message: "Action successful",
      smsSent: !!request.phone 
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to create the action" })
  }
})

/* ==========================
   Requests with docs (search by date optional)
   ========================== */
router.get("/api/requests-with-docs", async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    let query = `
      SELECT r.request_id, r.student_id, r.document_id, r.payment, r.status,
             r.release_date, r.submission_date, r.reason, r.payment_attachment,
             r.reference_no, r.amount, r.rejection_reason, r.request_rejection,
             d.name AS document_name, d.description, d.processing_time, d.fee
      FROM requests r
      LEFT JOIN document_types d ON r.document_id = d.document_id
    `
    const params = []

    if (startDate && endDate) {
      query += ` WHERE DATE(r.submission_date) BETWEEN ? AND ?`
      params.push(startDate, endDate)
    }

    query += ` ORDER BY r.submission_date DESC`

    const [rows] = await pool.query(query, params)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Internal server error" })
  }
})

/* ==========================
   Users: get all
   ========================== */
router.get("/get-all-users", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM `user`")
    res.json(rows)
  } catch (err) {
    console.error("Error: ", err)
    res.status(500).json({ error: "Server error" })
  }
})

/* ==========================
   Update user
   ========================== */
router.put("/update-user", async (req, res) => {
  try {
    const { userID, username, email, role } = req.body
    const [findUser] = await pool.query("SELECT * FROM `user` WHERE (username = ? OR email = ?) AND uid != ?", [username, email, userID])

    if (findUser.length > 0) {
      return res.status(400).json({ message: "User with this email/username already exists" })
    }

    await pool.query(
      "UPDATE `user` SET username = ?, email = ?, role = ? WHERE uid = ?",
      [username, email, role, userID]
    )

    return res.status(200).json({
      message: "User updated successfully!"
    })
  } catch (err) {
    console.error( "Error message: ", err )
    res.status(500).json({ error: "Server error" })
  }
})

/* ==========================
   Delete user
   ========================== */
router.delete("/delete-user", async (req, res) => {
  try {
    const { userID, password, currentUserID } = req.body

    const [users] = await pool.query("SELECT password FROM `user` WHERE uid = ?", [currentUserID])
    if (users.length === 0) return res.status(401).json({ message: "Unauthorized" })

    const validPassword = await bcrypt.compare(password, users[0].password)
    if (!validPassword) return res.status(401).json({ message: "Invalid password" })

    const [result] = await pool.query("DELETE FROM `user` WHERE uid = ?", [userID])
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" })
    }

    res.status(200).json({ message: "User deleted successfully!" })
  } catch (err) {
    console.error("Delete user error:", err)
    res.status(500).json({ message: "Server error" })
  }
})

/* ==========================
   Get user by id
   ========================== */
router.get("/api/users/:id", async (req, res) => {
  const { id } = req.params
  try {
    const [rows] = await pool.query("SELECT * FROM `user` WHERE uid = ?", [id])
    if (rows.length === 0) return res.status(404).json({ message: "User not found" })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Internal server error" })
  }
})

router.delete("/cancel-request/:request_id", async (req, res) => {
  const { request_id } = req.params
  try {
    const [result] = await pool.query(
      "DELETE FROM requests WHERE request_id = ?",
      [request_id]
    )
    return res.status(200).json({ message: "Document request has been cancelled." })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: "Internal server error." })
  }
})

router.post("/add-to-cart", async (req, res) => {
  const { user_id, doc_id, reason } = req.body
  if (!user_id || !doc_id || !reason)
    return res.status(400).json({ message: "Missing required fields" })

  try {
    // Prevent duplicate items
    const [existing] = await pool.query(
      "SELECT * FROM document_cart WHERE user_id = ? AND doc_id = ?",
      [user_id, doc_id]
    )

    if (existing.length > 0)
      return res.status(400).json({ message: "Document already in cart." })

    // Insert with reason
    await pool.query(
      "INSERT INTO document_cart (user_id, doc_id, reason) VALUES (?, ?, ?)",
      [user_id, doc_id, reason]
    )

    res.status(200).json({ message: "Document added to cart successfully." })
  } catch (err) {
    console.error("Error adding to cart:", err)
    res.status(500).json({ message: "Internal server error." })
  }
})

router.get("/cart", async (req, res) => {
  const { user_id } = req.query
  if (!user_id) return res.status(400).json({ message: "Missing user_id" })

  try {
    const [rows] = await pool.query(
      `SELECT 
        c.item_id,
        d.document_id,
        d.name AS doc_name,
        d.fee AS doc_fee,
        d.category,
        c.reason
      FROM document_cart c
      JOIN document_types d ON c.doc_id = d.document_id
      WHERE c.user_id = ?`,
      [user_id]
    )

    res.json(rows)
  } catch (err) {
    console.error("Error fetching cart:", err)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.delete("/remove-from-cart/:item_id", async (req, res) => {
  const { item_id } = req.params

  if (!item_id) {
    return res.status(400).json({ message: "Missing item_id" })
  }

  try {
    const [result] = await pool.query(
      "DELETE FROM document_cart WHERE item_id = ?",
      [item_id]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Item not found" })
    }

    res.status(200).json({ message: "Item removed from cart successfully." })
  } catch (err) {
    console.error("Error removing from cart:", err)
    res.status(500).json({ message: "Internal server error." })
  }
})

router.post("/checkout", async (req, res) => {
  try {
    const { user_id, items } = req.body;

    if (!user_id || !items || items.length === 0) {
      return res.status(400).json({ message: "Invalid checkout data" });
    }

    // Extract document IDs from items
    const documentIds = items.map(item => item.document_id || item.doc_id);
    
    // ✅ Get document fees AND names from document_types table
    const [documents] = await pool.query(
      "SELECT document_id, fee, name FROM document_types WHERE document_id IN (?)",
      [documentIds]
    );

    // Calculate total amount
    const totalAmount = documents.reduce((sum, doc) => sum + parseFloat(doc.fee || 0), 0);

    // ✅ Use doc_name from items (already provided by cart query)
    // Fallback to name from documents table if not present
    const reasonsList = items.map(item => {
      const doc = documents.find(d => d.document_id === (item.document_id || item.doc_id));
      const docName = item.doc_name || doc?.name || 'Document';
      return `${docName}: ${item.reason || 'No reason provided'}`;
    }).join('; ');

    // Create ONE request for all documents
    const submission_date = new Date().toISOString();
    const [result] = await pool.query(
      `INSERT INTO requests 
       (student_id, document_ids, payment, status, submission_date, amount, reason) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        JSON.stringify(documentIds),
        "pending",
        "Pending",
        submission_date,
        totalAmount.toFixed(2),
        reasonsList
      ]
    );

    const requestId = result.insertId;

    // Insert into request_documents junction table
    for (const item of items) {
      await pool.query(
        "INSERT INTO request_documents (request_id, document_id) VALUES (?, ?)",
        [requestId, item.document_id || item.doc_id]
      );
    }

    // Remove items from cart using item_ids from the items array
    const itemIds = items.map(item => item.item_id);
    await pool.query(
      "DELETE FROM document_cart WHERE user_id = ? AND item_id IN (?)",
      [user_id, itemIds]
    );

    res.json({
      message: "Checkout successful! One request created for all documents.",
      request_id: requestId,
      total_documents: documentIds.length,
      total_amount: totalAmount.toFixed(2),
      reasons: reasonsList
    });

  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({
      message: "Checkout failed",
      details: error.message
    });
  }
});


// ============================================================================
// 🎓 STUDENT CLEARANCE ROUTES (FIXED!)
// ============================================================================

/**
 * ⏰ Helper: Check if clearance has expired
 */
function isClearanceExpired(clearanceExpiry) {
  // If no expiry is set, clearance is NOT expired (it's still valid)
  if (!clearanceExpiry) return false;
  
  const expiry = new Date(clearanceExpiry);
  const now = new Date();
  
  // If expiry is invalid, consider it not expired
  if (isNaN(expiry.getTime())) return false;
  
  // Check if current time is AFTER expiry time
  return now > expiry;
}

/**
 * Helper: Check if clearance is fully valid
 */
function isClearanceValid(clearance) {
  const allApproved = [
    clearance.registrar_status,
    clearance.guidance_status,
    clearance.mis_status,
    clearance.library_status,
    clearance.cashier_status,
  ].every((s) => s === "approved");

  return allApproved;
}

/**
 * GET /api/student-clearances
 * Get all students with clearance status
 */
router.get("/api/student-clearances", async (req, res) => {
  try {
    const query = `
      SELECT 
        u.uid, u.username, u.email, u.course, u.role,
        sc.registrar_status, sc.guidance_status, sc.mis_status, 
        sc.library_status, sc.cashier_status,
        sc.registrar_reason, sc.guidance_reason, sc.mis_reason,
        sc.library_reason, sc.cashier_reason,
        sc.registrar_approved_at, sc.guidance_approved_at, sc.mis_approved_at,
        sc.library_approved_at, sc.cashier_approved_at,
        sc.last_cleared, sc.clearance_expiry
      FROM \`user\` u
      LEFT JOIN student_clearance sc ON u.uid = sc.student_id
      WHERE u.role IN ('student', 'alumni')
      ORDER BY u.username ASC
    `;

    const [students] = await pool.query(query);

    // Add computed validity fields
    const studentsWithValidity = students.map((student) => ({
      ...student,
      is_expired: isClearanceExpired(student.clearance_expiry),
      is_valid: student.registrar_status
        ? isClearanceValid(student)
        : false,
    }));

    res.json({ students: studentsWithValidity });
  } catch (error) {
    console.error("Error fetching student clearances:", error);
    res.status(500).json({ message: "Failed to fetch student clearances" });
  }
});

/**
 * GET /api/student-clearances/:studentId
 * Get specific student's clearance
 */
router.get("/api/student-clearances/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    console.log(`Fetching clearance for student ${studentId}`);

    const query = `
      SELECT 
        u.uid, u.username, u.email, u.course, u.role,
        sc.registrar_status, sc.guidance_status, sc.mis_status, 
        sc.library_status, sc.cashier_status, sc.engineering_status, sc.criminology_status,
        sc.registrar_reason, sc.guidance_reason, sc.mis_reason,
        sc.library_reason, sc.cashier_reason, sc.engineering_reason, sc.criminology_reason,
        sc.registrar_approved_at, sc.guidance_approved_at, sc.mis_approved_at,
        sc.library_approved_at, sc.cashier_approved_at, sc.engineering_approved_at, sc.criminology_approved_at,
        sc.registrar_rejected_at, sc.guidance_rejected_at, sc.mis_rejected_at,
        sc.library_rejected_at, sc.cashier_rejected_at, sc.engineering_rejected_at, sc.criminology_rejected_at,
        sc.last_cleared, sc.clearance_expiry
      FROM \`user\` u
      LEFT JOIN student_clearance sc ON u.uid = sc.student_id
      WHERE u.uid = ?
    `;

    const [results] = await pool.query(query, [studentId]);

    if (results.length === 0) {
      console.log(`Student ${studentId} not found`);
      return res
        .status(404)
        .json({ message: "Student not found" });
    }

    // If no clearance record exists, create one
    if (!results[0].registrar_status) {
      console.log(`Creating new clearance record for student ${studentId}`);

      await pool.query(
        "INSERT INTO student_clearance (student_id) VALUES (?)",
        [studentId]
      );

      const [newResults] = await pool.query(query, [studentId]);
      return res.json({
        ...newResults[0],
        is_expired: true,
        is_valid: false,
      });
    }

    // Check if expired and reset if needed
    const clearance = results[0];
    if (isClearanceExpired(clearance.clearance_expiry)) {
      console.log(
        `Clearance expired for student ${studentId}, resetting...`
      );

      await pool.query(
        `
        UPDATE student_clearance 
        SET registrar_status = 'pending',
            guidance_status = 'pending',
            mis_status = 'pending',
            library_status = 'pending',
            cashier_status = 'pending',
            engineering_status = 'pending',
            criminology_status = 'pending',
            registrar_reason = NULL,
            guidance_reason = NULL,
            mis_reason = NULL,
            library_reason = NULL,
            cashier_reason = NULL,
            engineering_reason = NULL,
            criminology_reason = NULL,
            registrar_approved_at = NULL,
            guidance_approved_at = NULL,
            mis_approved_at = NULL,
            library_approved_at = NULL,
            cashier_approved_at = NULL,
            engineering_approved_at = NULL,
            criminology_approved_at = NULL,
            registrar_rejected_at = NULL,
            guidance_rejected_at = NULL,
            mis_rejected_at = NULL,
            library_rejected_at = NULL,
            cashier_rejected_at = NULL,
            engineering_rejected_at = NULL,
            criminology_rejected_at = NULL,
            clearance_expiry = NULL
        WHERE student_id = ?
      `,
        [studentId]
      );

      const [resetResults] = await pool.query(query, [studentId]);
      return res.json({
        ...resetResults[0],
        is_expired: true,
        is_valid: false,
        was_reset: true,
      });
    }

    console.log(`Successfully fetched clearance for student ${studentId}`);

    res.json({
      ...clearance,
      is_expired: false,
      is_valid: isClearanceValid(clearance),
    });
  } catch (error) {
    console.error("Error fetching student clearance:", error);
    res
      .status(500)
      .json({
        message: "Failed to fetch student clearance",
        details: error.message,
      });
  }
});

/**
 * PUT /api/student-clearances/:studentId/:department
 * Update department clearance status
 */
router.put(
  "/api/student-clearances/:studentId/:department",
  async (req, res) => {
    try {
      const { studentId, department } = req.params;
      const { status, reason } = req.body;

      console.log(`Updating clearance - Student: ${studentId}, Dept: ${department}, Status: ${status}`);

      // Validate department
      const validDepts = [
        "registrar",
        "guidance",
        "mis",
        "library",
        "cashier",
        "business",
        "engineering",
        "criminology",
        "engineering and architecture",
        "criminal justice",
        "business and technology",
      ];
      
      if (!validDepts.includes(department)) {
        return res.status(400).json({ message: "Invalid department" });
      }

      // Map display names to database field names
      const deptMap = {
        "engineering and architecture": "engineering",
        "criminal justice": "criminology",
        "business and technology": "business",
      };
      
      const dbDept = deptMap[department] || department;

      // Validate status
      if (!["approved", "rejected", "pending"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      // Check if clearance record exists
      const checkQuery =
        "SELECT * FROM student_clearance WHERE student_id = ?";
      const [existing] = await pool.query(checkQuery, [studentId]);

      if (existing.length === 0) {
        console.log(`Creating clearance record for student ${studentId}`);
        await pool.query(
          "INSERT INTO student_clearance (student_id) VALUES (?)",
          [studentId]
        );
      }

      // Fetch the latest record
      const [updatedRecord] = await pool.query(checkQuery, [studentId]);
      const clearance = updatedRecord[0];

      // Reset expired clearance if needed
      if (isClearanceExpired(clearance.clearance_expiry)) {
        console.log(`Resetting expired clearance for student ${studentId}`);
        await pool.query(
          `UPDATE student_clearance 
          SET registrar_status = 'pending',
              guidance_status = 'pending',
              mis_status = 'pending',
              library_status = 'pending',
              cashier_status = 'pending',
              business_status = 'pending',
              engineering_status = 'pending',
              criminology_status = 'pending',
              registrar_reason = NULL,
              guidance_reason = NULL,
              mis_reason = NULL,
              library_reason = NULL,
              cashier_reason = NULL,
              business_reason = NULL,
              engineering_reason = NULL,
              criminology_reason = NULL,
              registrar_approved_at = NULL,
              guidance_approved_at = NULL,
              mis_approved_at = NULL,
              library_approved_at = NULL,
              cashier_approved_at = NULL,
              business_approved_at = NULL,
              engineering_approved_at = NULL,
              criminology_approved_at = NULL,
              registrar_rejected_at = NULL,
              guidance_rejected_at = NULL,
              mis_rejected_at = NULL,
              library_rejected_at = NULL,
              cashier_rejected_at = NULL,
              business_rejected_at = NULL,
              engineering_rejected_at = NULL,
              criminology_rejected_at = NULL,
              clearance_expiry = NULL,
              last_cleared = NULL
          WHERE student_id = ?`,
          [studentId]
        );
      }

      // Apply the department update
      const statusField = `${dbDept}_status`;
      const reasonField = `${dbDept}_reason`;
      const approvedAtField = `${dbDept}_approved_at`;
      const rejectedAtField = `${dbDept}_rejected_at`;

      let updateQuery, params;

      if (status === "approved") {
        updateQuery = `
          UPDATE student_clearance 
          SET ${statusField} = ?, 
              ${reasonField} = NULL,
              ${approvedAtField} = NOW(),
              ${rejectedAtField} = NULL
          WHERE student_id = ?
        `;
        params = [status, studentId];
      } else if (status === "rejected") {
        updateQuery = `
          UPDATE student_clearance 
          SET ${statusField} = ?, 
              ${reasonField} = ?,
              ${approvedAtField} = NULL,
              ${rejectedAtField} = NOW()
          WHERE student_id = ?
        `;
        params = [status, reason || null, studentId];
      } else {
        updateQuery = `
          UPDATE student_clearance 
          SET ${statusField} = ?, 
              ${reasonField} = NULL,
              ${approvedAtField} = NULL,
              ${rejectedAtField} = NULL
          WHERE student_id = ?
        `;
        params = [status, studentId];
      }

      const [updateResult] = await pool.query(updateQuery, params);

      if (updateResult.affectedRows === 0) {
        return res.status(500).json({ message: "Failed to update clearance" });
      }

      // Check if all relevant departments are approved
      const [final] = await pool.query(checkQuery, [studentId]);
      const finalClearance = final[0];

      const [studentInfo] = await pool.query(
        "SELECT course, role FROM user WHERE uid = ?",
        [studentId]
      );
      
      const studentCourse = (studentInfo[0]?.course || "").toLowerCase().trim();
      const studentRole = (studentInfo[0]?.role || "").toLowerCase();
      
      let allApproved = false;

      // Alumni check
      if (studentRole === "alumni") {
        allApproved = 
          finalClearance.registrar_status === "approved" && 
          finalClearance.cashier_status === "approved";
      } else {
        // Regular students - base departments
        const baseDepts = ["registrar", "guidance", "library", "cashier"];
        allApproved = baseDepts.every(d => 
          finalClearance[`${d}_status`] === "approved"
        );

        // Check program head clearance
        if (allApproved) {
          const misCourses = [
            "bachelor of science in accountancy",
            "bachelor of science in accounting technology",
            "bachelor of science in entrepreneurship",
            "bachelor of science in information technology",
            "bachelor of science in computer engineering",
          ];
          
          const engineeringCourses = [
            "bachelor of science in architecture",
            "bachelor of science in civil engineering",
            "bachelor of science in electronics engineering",
            "bachelor of science in electrical engineering",
            "bachelor of science in mechanical engineering",
          ];
          
          const criminologyCourses = ["bachelor of science in criminology"];

          if (misCourses.includes(studentCourse)) {
            allApproved = finalClearance.mis_status === "approved";
          } else if (engineeringCourses.includes(studentCourse)) {
            allApproved = finalClearance.engineering_status === "approved";
          } else if (criminologyCourses.includes(studentCourse)) {
            allApproved = finalClearance.criminology_status === "approved";
          }
        }
      }

      if (allApproved) {
        console.log(`All relevant departments approved for student ${studentId}! Setting expiry to 6 months`);
        
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 6);
        
        await pool.query(
          `UPDATE student_clearance 
          SET last_cleared = NOW(),
              clearance_expiry = ?
          WHERE student_id = ?`,
          [expiryDate, studentId]
        );
        
        console.log(`✅ Clearance expiry set to: ${expiryDate.toISOString()}`);

        // NEW: Trigger SMS notification check
        if (status === "approved") {
          // Trigger the completion check in the background
          // Use a separate request to avoid blocking this response
          fetch(`http://localhost:${process.env.PORT || 3000}/api/check-clearance-completion/${studentId}`, {
            method: 'POST',
          }).catch(err => {
            console.error("Failed to trigger SMS check:", err);
          });
        }
      }

      console.log(`Successfully updated ${dbDept} clearance for student ${studentId}`);
      res.json({ 
        message: "Clearance updated successfully",
        allApproved: allApproved,
        expirySet: allApproved
      });
    } catch (error) {
      console.error("Error updating clearance:", error);
      res.status(500).json({
        message: "Failed to update clearance",
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/student-clearances/:studentId/reset
 * Manual clearance reset (for admins)
 */
router.post("/api/student-clearances/:studentId/reset", async (req, res) => {
  try {
    const { studentId } = req.params;

    console.log(`Manually resetting clearance for student ${studentId}`);

    await pool.query(
      `
      UPDATE student_clearance 
      SET registrar_status = 'pending',
          guidance_status = 'pending',
          mis_status = 'pending',
          library_status = 'pending',
          cashier_status = 'pending',
          registrar_reason = NULL,
          guidance_reason = NULL,
          mis_reason = NULL,
          library_reason = NULL,
          cashier_reason = NULL,
          registrar_approved_at = NULL,
          guidance_approved_at = NULL,
          mis_approved_at = NULL,
          library_approved_at = NULL,
          cashier_approved_at = NULL,
          clearance_expiry = NULL
      WHERE student_id = ?
    `,
      [studentId]
    );

    console.log(`Successfully reset clearance for student ${studentId}`);
    res.json({ message: "Clearance reset successfully" });
  } catch (error) {
    console.error("Error resetting clearance:", error);
    res
      .status(500)
      .json({
        message: "Failed to reset clearance",
        details: error.message,
      });
  }
});

/**
 * GET /api/student-clearances/:studentId/can-request
 * Check if student can request documents
 */
router.get(
  "/api/student-clearances/:studentId/can-request",
  async (req, res) => {
    try {
      const { studentId } = req.params;

      const [results] = await pool.query(
        "SELECT * FROM student_clearance WHERE student_id = ?",
        [studentId]
      );

      // No clearance record
      if (results.length === 0) {
        return res.json({
          can_request: false,
          reason:
            "No clearance record found. Please complete your clearance first.",
        });
      }

      const clearance = results[0];

      // Check if expired
      if (isClearanceExpired(clearance.clearance_expiry)) {
        return res.json({
          can_request: false,
          reason:
            "Your clearance has expired. Please get re-approved by all departments.",
        });
      }

      // Check if all approved
      const allApproved = [
        clearance.registrar_status,
        clearance.guidance_status,
        clearance.mis_status,
        clearance.library_status,
        clearance.cashier_status,
      ].every((s) => s === "approved");

      if (!allApproved) {
        return res.json({
          can_request: false,
          reason:
            "You must be cleared by all departments before requesting documents.",
        });
      }

      // All good!
      res.json({
        can_request: true,
        clearance_expiry: clearance.clearance_expiry,
      });
    } catch (error) {
      console.error("Error checking clearance:", error);
      res
        .status(500)
        .json({
          message: "Failed to check clearance",
          details: error.message,
        });
    }
  }
);

// Add this new route to handle marking requests as completed
router.put("/complete-request/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;

    // Get request details, student info, and clearance status
    const [requestData] = await pool.query(
      `SELECT r.*, u.phone, u.username, u.course, u.role, d.name as document_name
       FROM requests r 
       JOIN user u ON r.student_id = u.uid 
       LEFT JOIN document_types d ON r.document_id = d.document_id
       WHERE r.request_id = ?`,
      [request_id]
    );

    if (requestData.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = requestData[0];

    // Fetch student clearance
    const [clearanceData] = await pool.query(
      "SELECT * FROM student_clearance WHERE student_id = ?",
      [request.student_id]
    );

    if (clearanceData.length === 0) {
      return res.status(400).json({ 
        message: "Student clearance not found. Please ensure all clearances are completed first." 
      });
    }

    const clearance = clearanceData[0];
    const courseLower = (request.course || "").toLowerCase().trim();
    const studentRole = (request.role || "").toLowerCase();

    // Check if all required clearances are approved
    let allClearancesApproved = false;

    if (studentRole === "alumni") {
      allClearancesApproved = 
        clearance.registrar_status === "approved" && 
        clearance.cashier_status === "approved";
    } else {
      // Base departments
      const baseDepts = ["registrar", "guidance", "library", "cashier"];
      allClearancesApproved = baseDepts.every(d => 
        clearance[`${d}_status`] === "approved"
      );

      // Check program head clearance
      if (allClearancesApproved) {
        const misCourses = [
          "bachelor of science in accountancy",
          "bachelor of science in accounting technology",
          "bachelor of science in entrepreneurship",
          "bachelor of science in information technology",
          "bachelor of science in computer engineering",
        ];
        
        const engineeringCourses = [
          "bachelor of science in architecture",
          "bachelor of science in civil engineering",
          "bachelor of science in electronics engineering",
          "bachelor of science in electrical engineering",
          "bachelor of science in mechanical engineering",
        ];
        
        const criminologyCourses = ["bachelor of science in criminology"];

        if (misCourses.includes(courseLower)) {
          allClearancesApproved = clearance.mis_status === "approved";
        } else if (engineeringCourses.includes(courseLower)) {
          allClearancesApproved = clearance.engineering_status === "approved";
        } else if (criminologyCourses.includes(courseLower)) {
          allClearancesApproved = clearance.criminology_status === "approved";
        }
      }
    }

    if (!allClearancesApproved) {
      return res.status(400).json({ 
        message: "Cannot mark as completed. All required clearances must be approved first." 
      });
    }

    // Update request status to completed and set completed_at timestamp
    const [result] = await pool.query(
      "UPDATE requests SET status = 'completed', completed_at = NOW() WHERE request_id = ?",
      [request_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Failed to update request" });
    }

    // Calculate pickup date (using release_date as base)
    const processingTimes = {
      "good moral certificate": 3,
      "certificate of registration": 2,
      "certificate of grades": 2,
      "transcript of records": 7,
      "form 137 (school records)": 5,
      "diploma": 15,
      "certification of graduation": 4,
      "honorable dismissal": 3,
    };

    const docNameLower = (request.document_name || "").toLowerCase();
    const daysToAdd = processingTimes[docNameLower] || 3;
    
    const releaseDate = new Date(request.release_date);
    let businessDays = 0;
    let pickupDate = new Date(releaseDate);
    
    while (businessDays < daysToAdd) {
      pickupDate.setDate(pickupDate.getDate() + 1);
      const dayOfWeek = pickupDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        businessDays++;
      }
    }
    
    const pickupDateFormatted = pickupDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Send SMS notification
    if (request.phone) {
      const smsMessage = `Hi ${request.username}, your requested document "${request.document_name}" (Request #${request_id}) is now ready for pickup at BHC Registrar's Office on ${pickupDateFormatted}. Please bring a valid ID.`;
      
      await sendSMS(request.phone, smsMessage).catch(err => {
        console.error("SMS sending failed:", err);
      });
      console.log(`✅ Document ready SMS sent to ${request.phone}`);
    }

    res.json({ 
      message: "Request marked as completed successfully",
      requestId: request_id,
      pickupDate: pickupDateFormatted,
      smsSent: !!request.phone 
    });

  } catch (error) {
    console.error("Error completing request:", error);
    res.status(500).json({ 
      message: "Failed to mark request as completed",
      details: error.message 
    });
  }
});

export default router
