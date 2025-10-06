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
const port = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------
// CORS Configuration
// -------------------
const allowedOrigins = [
  "https://mydocurequest.bhc1979.com", // deployed frontend
  "http://localhost:3000" // local dev
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.warn(`Blocked by CORS: ${origin}`);
      return callback(null, false); // <-- just block it instead of throwing error
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));

// -------------------
// Middlewares
// -------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/attachments", express.static(path.join(__dirname, "attachments")));

// -------------------
// Routes
// -------------------
app.use(authRoutes);
app.use(requestRoutes);

// -------------------
// Optional test route for DB
// -------------------
app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM user LIMIT 5");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------
// Fallback route
// -------------------
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// -------------------
// Start server
// -------------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
