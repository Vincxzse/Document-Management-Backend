import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function importSQL() {
  // Connect to the database
  const connection = await mysql.createConnection(process.env.DB_URL);

  // Read the SQL dump file
  const sql = fs.readFileSync('dump.sql', 'utf8');

  // Split the SQL into individual queries
  const queries = sql
    .split(/;\s*$/m) // split by semicolon
    .map(q => q.trim())
    .filter(q => q.length > 0); // remove empty lines

  console.log(`Found ${queries.length} queries. Starting import...`);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    try {
      await connection.query(query);
    } catch (err) {
      console.error(`Error executing query #${i + 1}:`, err.message);
    }
  }

  console.log("SQL import completed successfully!");
  await connection.end();
}

importSQL().catch(err => console.error("Import failed:", err));
