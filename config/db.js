import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DB_URL,
    ssl: {
      rejectUnauthorized: false,
    }
});


pool.on("connect", () => {
  console.log("Connected to render PostgreSQL");
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err);
});

export default pool;