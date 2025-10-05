import pool from './database/db.js';

(async () => {
  try {
    const [rows] = await pool.query("SELECT 1+1 AS test");
    console.log("DB connected:", rows);
  } catch (err) {
    console.error("DB connection error:", err.message);
  }
})();
