
import express from 'express'
import pool from '../database/db.js'

const router = express.Router()

router.get("/get-all-documents", async (req, res) => {
    try {
        const [getDocs] = await pool.query("SELECT * FROM document_types")
        return res.status(200).json({
            message: "Fetching data successful",
            data: getDocs
        })
    } catch (err) {
        console.error("Error fetching documents:", err)
        return res.status(500).json({
            message: "An error occurred while fetching documents",
            error: err.message
        })
    }
})

router.put("/edit-document", async (req, res) => {
    try {
        const { document_id, docName, docDesc, processingTime, docFee, docCategory } = req.body
        const [rows] = await pool.query("SELECT * FROM document_types WHERE name = ? AND document_id != ?", [docName, document_id])
        if (rows.length > 0) return res.status(400).json({ message: "Document with this name already exists" })
        const [result] = await pool.query("UPDATE document_types SET name = ?, description = ?, processing_time = ?, fee = ?, category = ? WHERE document_id = ?", [docName, docDesc, processingTime, docFee, docCategory, document_id])
        return res.status(200).json({ message: "Document updated successfully" })
    } catch (err) {
        console.error("Error updating document: ", err)
        return res.status(500).json({
            message: "An error occurred while updating document",
            error: err.message
        })
    }
})

router.post("/create-document", async (req, res) => {
    try {
        const { docName, docDesc, processingTime, docFee, docCategory } = req.body
        const [rows] = await pool.query("SELECT * FROM document_types WHERE name = ?", [docName])
        if (rows.length > 0) return res.status(400).json({ message: "Document with this name already exists" })
        const [result] = await pool.query(
            "INSERT INTO document_types(name, description, processing_time, fee, category) VALUES(?, ?, ?, ?, ?)",
            [docName, docDesc, processingTime, docFee, docCategory]
        )
        return res.status(200).json({ message: "Document created successfully!" })
    } catch (err) {
        console.error("Error creating document: ", err)
        return res.status(500).json({ message: "An error has occurred while creating document", error: err.message })
    }
})

router.delete("/delete-document/:document_id", async (req, res) => {
    try {
        const { document_id } = req.params
        const [result] = await pool.query("DELETE FROM document_types WHERE document_id = ?", [document_id])
        return res.status(200).json({ message: "Document deleted successfully" })
    } catch (err) {
        console.err("Error deleting document: ", err)
        return res.status(500).json({ message: "An error has occurred while deleting document", error: err.message })
    }
})

export default router