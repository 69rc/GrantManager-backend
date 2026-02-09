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

// Masked logging for debugging ENOTFOUND issues
const dbUrl = process.env.DATABASE_URL;
const maskedUrl = dbUrl.substring(0, 15) + "..." + dbUrl.substring(dbUrl.length - 5);
console.log(`[DB-DEBUG] DATABASE_URL length: ${dbUrl.length}, prefix: ${maskedUrl}`);

// For Vercel deployment, we need to handle connection pooling carefully
const poolConfig = {
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
};

// Only enable SSL in production or if explicitly requested
if (process.env.NODE_ENV === "production" || process.env.DB_SSL === "true") {
    poolConfig.ssl = {
        rejectUnauthorized: false
    };
    console.log("[DB-DEBUG] SSL enabled");
} else {
    console.log("[DB-DEBUG] SSL disabled (local/development)");
}

const pool = new pg.Pool(poolConfig);


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
