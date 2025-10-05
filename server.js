import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes.js";
import requestRoutes from "./routes/requestRoutes.js";
import pool from "./database/db.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000; // Render assigns a port

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve attachments
app.use("/attachments", express.static(path.join(__dirname, "attachments")));

// Routes
app.use(authRoutes)
app.use(requestRoutes)

// Optional test route for DB
app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM user LIMIT 5");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
