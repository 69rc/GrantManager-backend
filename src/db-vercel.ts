import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import dotenv from "dotenv";

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// For Vercel deployment, we need to handle connection pooling carefully
// In serverless environments, we typically want to allow more idle connections
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Recommended settings for serverless environments
  max: 1, // Limit to 1 connection per instance to avoid connection limits
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// In production, log notices to help with debugging
if (process.env.NODE_ENV === "production") {
  pool.on("connect", () => {
    console.log("Database connected");
  });
  
  pool.on("error", (err) => {
    console.error("Database connection error:", err);
  });
}

export const db = drizzle(pool);