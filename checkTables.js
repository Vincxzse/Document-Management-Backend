import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

async function checkTables() {
  const conn = await mysql.createConnection(process.env.DB_URL);
  const [rows] = await conn.query("SHOW TABLES;");
  console.log(rows);
  await conn.end();
}

checkTables();
