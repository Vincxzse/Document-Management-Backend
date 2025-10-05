import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from "url";

import authRoutes from "./routes/authRoutes.js";
import requestRoutes from "./routes/requestRoutes.js";

const app = express();
const port = process.env.PORT || 5000; // Use Render's assigned port

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// Serve attachments
app.use("/attachments", express.static(path.join(__dirname, "attachments")));

// Add prefixes to routes
app.use("/api/auth", authRoutes);
app.use("/api/requests", requestRoutes);

// Temporary test route for DB
import pool from "./db.js";
app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM user LIMIT 5");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
