import express from "express"
import pool from "../database/db.js"

const router = express.Router()

router.get("/get-onsite-requests", async (req, res) => {
    try {
        const [result] = await pool.query("SELECT * FROM onsite_request ORDER BY request_date DESC")
        return res.status(200).json({ requests: result })
    } catch (err) {
        console.error("get onsite requests: ", err)
        res.status(500).json({ message: "An error has occurred while fetching onsite requests" })
    }
})

router.post("/create-onsite-request", async (req, res) => {
    try {
        const { requests } = req.body

        if (!requests || !Array.isArray(requests) || requests.length === 0) {
            return res.status(400).json({ message: "Invalid request data" })
        }

        // Insert all requests with reason field
        const values = requests.map(req => [
            req.name,
            req.phone,
            req.course,
            req.document_requested,
            req.reason  // Add reason field
        ])

        const placeholders = values.map(() => "(?, ?, ?, ?, ?)").join(", ")
        const flatValues = values.flat()

        await pool.query(
            `INSERT INTO onsite_request (name, phone, course, document_requested, reason) 
             VALUES ${placeholders}`,
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

// Updated route to get all requests (both online and onsite) for Request History
router.get("/api/requests-with-docs", async (req, res) => {
    try {
        const { startDate, endDate } = req.query
        
        console.log("Fetching requests with docs - Date range:", startDate, endDate)
        
        // First, let's check if onsite_request table exists and get its structure
        let onlineResults = []
        let onsiteResults = []
        
        // Fetch online requests
        try {
            let onlineQuery = `
                SELECT 
                    r.request_id,
                    COALESCE(d.name, 'Unknown Document') as document_name,
                    COALESCE(r.status, 'pending') as status,
                    r.submission_date,
                    r.release_date,
                    r.amount,
                    'online' as request_type
                FROM requests r
                LEFT JOIN document_types d ON r.document_id = d.document_id
            `
            
            const onlineParams = []
            
            if (startDate && endDate) {
                onlineQuery += ` WHERE DATE(r.submission_date) BETWEEN ? AND ?`
                onlineParams.push(startDate, endDate)
            }
            
            onlineQuery += ` ORDER BY r.submission_date DESC`
            
            const [rows] = await pool.query(onlineQuery, onlineParams)
            onlineResults = rows
            console.log(`Fetched ${onlineResults.length} online requests`)
        } catch (onlineErr) {
            console.error("Error fetching online requests:", onlineErr)
            throw onlineErr
        }
        
        // Fetch onsite requests
        try {
            let onsiteQuery = `
                SELECT 
                    request_id,
                    document_requested as document_name,
                    COALESCE(status, 'pending') as status,
                    request_date as submission_date,
                    release_date,
                    NULL as amount,
                    'onsite' as request_type
                FROM onsite_request
            `
            
            const onsiteParams = []
            
            if (startDate && endDate) {
                onsiteQuery += ` WHERE DATE(request_date) BETWEEN ? AND ?`
                onsiteParams.push(startDate, endDate)
            }
            
            onsiteQuery += ` ORDER BY request_date DESC`
            
            const [rows] = await pool.query(onsiteQuery, onsiteParams)
            onsiteResults = rows
            console.log(`Fetched ${onsiteResults.length} onsite requests`)
        } catch (onsiteErr) {
            console.error("Error fetching onsite requests:", onsiteErr)
            // If onsite table doesn't exist or has issues, just continue with online results
            console.log("Continuing with online requests only")
        }
        
        // Combine results
        const combinedResults = [...onlineResults, ...onsiteResults]
        
        // Sort by submission_date descending
        combinedResults.sort((a, b) => {
            const dateA = new Date(a.submission_date)
            const dateB = new Date(b.submission_date)
            return dateB - dateA
        })
        
        console.log(`Total combined requests: ${combinedResults.length}`)
        res.status(200).json(combinedResults)
        
    } catch (err) {
        console.error("get requests with docs error:", err)
        console.error("Error details:", err.message)
        console.error("SQL error:", err.sql)
        res.status(500).json({ 
            message: "Failed to fetch requests",
            error: err.message 
        })
    }
})

export default router
