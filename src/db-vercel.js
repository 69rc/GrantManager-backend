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
// We handle SSL explicitly to avoid "self signed certificate" errors with managed Postgres
// Stripping sslmode/pgbouncer from the URL to let pg-pool handle connection details via the config object
let connectionString = dbUrl;
const needsSSL = dbUrl.includes("sslmode=require") || process.env.NODE_ENV === "production" || process.env.DB_SSL === "true";

try {
    const parsedUrl = new URL(dbUrl);
    parsedUrl.searchParams.delete("sslmode");
    // pgbouncer=true can sometimes cause issues with certain pg versions if not handled by the pooler
    parsedUrl.searchParams.delete("pgbouncer");
    connectionString = parsedUrl.toString();
} catch (e) {
    console.error("[DB-DEBUG] Failed to parse DATABASE_URL, using original", e.message);
}


const poolConfig = {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
};


if (needsSSL) {
    poolConfig.ssl = {
        rejectUnauthorized: false
    };
    console.log("[DB-DEBUG] SSL enabled explicitly (rejectUnauthorized: false)");
} else {
    console.log("[DB-DEBUG] SSL disabled");
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
