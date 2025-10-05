// import mysql from "mysql2/promise"

// const pool = mysql.createPool({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "heroes",
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
// })

// export default pool

// import mysql from "mysql2/promise";

// const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
// });

// export default pool;


import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

// Use Railway's DB_URL if available, otherwise fallback to individual vars
const pool = mysql.createPool(
  process.env.DB_URL || {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  }
);

// Optional: test connection
async function testConnection() {
  try {
    const [rows] = await pool.query("SELECT 1 + 1 AS result");
    console.log("✅ Database connected. Test query result:", rows[0].result);
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
}

testConnection();

export default pool;
