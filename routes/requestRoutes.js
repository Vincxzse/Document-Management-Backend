import express from 'express'
import pool from '../database/db.js'
import bcrypt from 'bcryptjs'

const router = express.Router()

// Reject request
router.post('/reject-req/:request_id', async (req, res) => {
  const { request_id } = req.params
  const { reason } = req.body
  try {
    const [result] = await pool.query(
      "UPDATE requests SET request_rejection = ?, status = 'rejected' WHERE request_id = ?",
      [reason, request_id]
    )

    if (result.affectedRows === 0) return res.status(404).json({ error: "Request not found" })
    res.json({ message: "Request rejected successfully", requestId: request_id, reason })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Create request
router.post("/create-request", async (req, res) => {
  try {
    const { student_id, document_id, request_reason } = req.body
    if (!student_id || !document_id) {
      return res.status(400).json({ message: "Missing required fields" })
    }

    const [existing] = await pool.query(
      "SELECT * FROM requests WHERE document_id = ? AND student_id = ?",
      [document_id, student_id]
    )
    if (existing.length > 0) {
      return res.status(400).json({ message: "You already requested this document." })
    }

    const [docs] = await pool.query(
      "SELECT processing_time FROM document_types WHERE document_id = ?",
      [document_id]
    )
    if (docs.length === 0) {
      return res.status(404).json({ message: "Document not found" })
    }

    let daysToAdd = 0
    const match = docs[0].processing_time && docs[0].processing_time.match(/\d+/)
    if (match) daysToAdd = parseInt(match[0], 10)

    const submissionDate = new Date()
    const releaseDate = new Date(submissionDate)
    releaseDate.setDate(submissionDate.getDate() + daysToAdd)
    const formattedReleaseDate = releaseDate.toISOString().split("T")[0]

    // 1. Insert into requests
    const [result] = await pool.query(
      `INSERT INTO requests 
      (student_id, document_id, submission_date, release_date, status, payment, reason) 
      VALUES (?, ?, NOW(), ?, 'pending', 'pending', ?)`,
      [student_id, document_id, formattedReleaseDate, request_reason]
    )

    const requestId = result.insertId

    // 2. Insert into request_clearances (auto-create record)
    await pool.query("INSERT INTO request_clearances (request_id) VALUES (?)", [requestId])

    res.status(201).json({
      message: "Request created successfully",
      requestId,
      release_date: formattedReleaseDate,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Approve payment
router.put("/approve-payment/:id", async (req, res) => {
  const { id } = req.params
  try {
    await pool.query("UPDATE requests SET payment = 'approved' WHERE request_id = ?", [id])
    res.json({ message: "Payment approved successfully" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to approve payment" })
  }
})

// Reject payment
router.put("/reject-payment/:id", async (req, res) => {
  const { id } = req.params
  const { reason } = req.body
  try {
    await pool.query(
      "UPDATE requests SET payment = 'rejected', rejection_reason = ? WHERE request_id = ?",
      [reason, id]
    )
    res.json({ message: "Payment rejected successfully" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to reject payment" })
  }
})

// Get all clearances (joined with user info)
router.get("/api/clearances", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        r.request_id, r.student_id, r.document_id, r.status AS request_status, r.payment,
        u.uid, u.username, u.course, u.email,
        c.registrar_status, c.registrar_reason,
        c.guidance_status, c.guidance_reason,
        c.engineering_status, c.engineering_reason,
        c.criminology_status, c.criminology_reason,
        c.mis_status, c.mis_reason,
        c.library_status, c.library_reason,
        c.cashier_status, c.cashier_reason
      FROM requests r
      JOIN user u ON r.student_id = u.uid
      LEFT JOIN request_clearances c ON r.request_id = c.request_id
      ORDER BY r.submission_date DESC
    `)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Internal server error" })
  }
})

router.get("/api/clearances/:requestId", async (req, res) => {
  const { requestId } = req.params;
  
  console.log(`Fetching clearance for request_id: ${requestId}`);
  
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
       LEFT JOIN user u ON r.student_id = u.uid
       WHERE r.request_id = ?`,
      [requestId]
    );

    if (requestRows.length === 0) {
      console.log(`Request ${requestId} not found`);
      return res.status(404).json({ message: "Request not found" });
    }

    const request = requestRows[0];

    // Try to get clearance data (may not exist yet)
    const [clearanceRows] = await pool.query(
      `SELECT * FROM request_clearances WHERE request_id = ?`,
      [requestId]
    );

    let clearanceData = {};
    if (clearanceRows.length > 0) {
      clearanceData = clearanceRows[0];
    } else {
      // No clearance yet - create one
      console.log(`No clearance found for request ${requestId}, creating one...`);
      await pool.query(
        "INSERT INTO request_clearances (request_id) VALUES (?)",
        [requestId]
      );
      clearanceData = {
        registrar_status: 'pending',
        guidance_status: 'pending',
        engineering_status: 'pending',
        criminology_status: 'pending',
        mis_status: 'pending',
        library_status: 'pending',
        cashier_status: 'pending'
      };
    }

    // Merge everything together and rename status to request_status for clarity
    const response = {
      ...request,
      request_status: request.status, // Rename for frontend
      ...clearanceData
    };

    console.log(`Successfully fetched clearance for request ${requestId}`);
    res.json(response);
    
  } catch (err) {
    console.error("Error fetching clearance:", err.message);
    console.error("Full error:", err);
    res.status(500).json({ 
      error: "Internal server error", 
      details: err.message,
      sql: err.sql 
    });
  }
});

// Update clearance for a department
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
    // Check if clearance record exists
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

    // Build update query with approval date
    let query, params

    if (status === "approved") {
      // Set approved status and timestamp
      query = `UPDATE request_clearances 
               SET ${department}_status = ?, 
                   ${department}_reason = NULL,
                   ${department}_approved_at = NOW()
               WHERE request_id = ?`
      params = [status, requestId]
    } else if (status === "rejected" && reason) {
      // Set rejected status with reason, clear approval date
      query = `UPDATE request_clearances 
               SET ${department}_status = ?, 
                   ${department}_reason = ?,
                   ${department}_approved_at = NULL
               WHERE request_id = ?`
      params = [status, reason, requestId]
    } else {
      query = `UPDATE request_clearances 
               SET ${department}_status = ?,
                   ${department}_approved_at = NULL
               WHERE request_id = ?`
      params = [status, requestId]
    }

    const [result] = await pool.query(query, params)

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Failed to update clearance" })
    }

    // Check if all departments are cleared
    const [clearanceStatus] = await pool.query(
      `SELECT 
        registrar_status, guidance_status, engineering_status,
        criminology_status, mis_status, library_status, cashier_status
      FROM request_clearances 
      WHERE request_id = ?`,
      [requestId]
    )

    if (clearanceStatus.length > 0) {
      const statuses = Object.values(clearanceStatus[0])
      const anyRejected = statuses.some(s => s === 'rejected')
      const allApproved = statuses.every(s => s === 'approved')

      if (anyRejected) {
        await pool.query(
          "UPDATE requests SET status = 'rejected' WHERE request_id = ?",
          [requestId]
        )
      } else if (allApproved) {
        await pool.query(
          "UPDATE requests SET status = 'approved' WHERE request_id = ?",
          [requestId]
        )
      }
    }

    res.json({ 
      message: `${department} clearance updated successfully`, 
      status, 
      reason: reason || null 
    })
  } catch (err) {
    console.error("Error updating clearance:", err)
    res.status(500).json({ error: "Internal server error", details: err.message })
  }
})

// Specific cashier route (deprecated but fixed to new table)
router.put("/api/clearances/:userId/cashier", async (req, res) => {
  const { userId } = req.params
  const { status } = req.body

  try {
    const [result] = await pool.query(
      `UPDATE request_clearances SET cashier_status = ? WHERE request_id = ?`,
      [status, userId]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Clearance not found" })
    }

    res.json({ message: "Cashier clearance updated" })
  } catch (err) {
    console.error("Error updating clearance:", err.message)
    res.status(500).json({ error: "Internal server error" })
  }
})

// ... (rest of your requests & users routes unchanged)

// Get requests for a student
router.get("/requests/:student_id", async (req, res) => {
  try {
    const { student_id } = req.params

    const [requests] = await pool.query(
      `SELECT 
        r.request_id, 
        r.student_id, 
        r.document_id, 
        r.status, 
        r.payment,
        r.request_rejection,
        r.rejection_reason,
        r.payment_attachment,
        DATE_FORMAT(r.submission_date, '%Y-%m-%d') AS submission_date,
        DATE_FORMAT(r.release_date, '%Y-%m-%d') AS release_date,
        d.name AS document_name
      FROM requests r
      JOIN document_types d ON r.document_id = d.document_id
      WHERE r.student_id = ?
      ORDER BY r.submission_date DESC`,
      [student_id]
    )

    res.status(200).json({ requests })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

// Get all requests (admin)
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

// Get requests (joined)
router.get("/get-requests", async (req, res) => {
  try {
    const [fetchRequests] = await pool.query(
      `SELECT r.*, d.name AS document_name, u.username
       FROM requests r
       INNER JOIN document_types d ON r.document_id = d.document_id
       INNER JOIN user u ON r.student_id = u.uid`
    )
    res.status(200).json({ fetchRequests })
  } catch (err) {
    console.error("Error: ", err.message)
    res.status(500).json({ error: "Failed to fetch request" })
  }
})


// Request status update
router.put("/request-status/:id", async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  try {
    await pool.query("UPDATE requests SET status = ? WHERE request_id = ?", [status, id])
    res.json({ message: "Action successful" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to create the action" })
  }
})

// Requests with docs
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

// Users: get all
router.get("/get-all-users", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM user")
    res.json(rows)
  } catch (err) {
    console.error("Error: ", err)
    res.status(500).json({ error: "Server error" })
  }
})

// Update user
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

// Delete user
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

// Get user by id
router.get("/api/users/:id", async (req, res) => {
  const { id } = req.params
  try {
    const [rows] = await pool.query("SELECT * FROM user WHERE uid = ?", [id])
    if (rows.length === 0) return res.status(404).json({ message: "User not found" })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Internal server error" })
  }
})

export default router
