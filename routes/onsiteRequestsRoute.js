import express from "express"
import pool from "../database/db.js"

const router = express.Router()

router.get("/get-onsite-requests", async (req, res) => {
    try {
        const [result] = await pool.query("SELECT * FROM onsite_request")
        return res.status(200).json({ requests: result })
    } catch (err) {
        console.error("get onsite requests: ", err)
        res.status(500).json({ message: "An error has occurred while fetching onsite requests" })
    }
})

// Add this to your router file

router.post("/create-onsite-request", async (req, res) => {
    try {
        const { requests } = req.body

        if (!requests || !Array.isArray(requests) || requests.length === 0) {
            return res.status(400).json({ message: "Invalid request data" })
        }

        // Insert all requests
        const values = requests.map(req => [
            req.name,
            req.phone,
            req.course,
            req.document_requested
        ])

        const placeholders = values.map(() => "(?, ?, ?, ?)").join(", ")
        const flatValues = values.flat()

        await pool.query(
            `INSERT INTO onsite_request (name, phone, course, document_requested) VALUES ${placeholders}`,
            flatValues
        )

        res.status(201).json({ 
            message: `${requests.length} onsite request(s) created successfully` 
        })
    } catch (err) {
        console.error("create onsite request:", err)
        res.status(500).json({ message: "An error occurred while creating onsite requests" })
    }
})

// Also add this route to fetch documents
router.get("/api/document-types", async (req, res) => {
    try {
        const [documents] = await pool.query(
            "SELECT document_id, name, description, processing_time, fee, category FROM document_types ORDER BY name ASC"
        )
        res.status(200).json(documents)
    } catch (err) {
        console.error("get document types:", err)
        res.status(500).json({ message: "Failed to fetch document types" })
    }
})

router.put("/complete-onsite-request/:requestId", async (req, res) => {
    try {
        const { requestId } = req.params
        
        // Update status to completed and set release_date to now
        const [result] = await pool.query(
            `UPDATE onsite_request 
             SET status = 'completed', release_date = NOW() 
             WHERE request_id = ?`,
            [requestId]
        )

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Request not found" })
        }

        res.status(200).json({ 
            message: "Request marked as completed successfully" 
        })
    } catch (err) {
        console.error("complete onsite request:", err)
        res.status(500).json({ message: "An error occurred while completing the request" })
    }
})

export default router