const pg = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function addColumn() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL not found in .env");
        return;
    }

    const pool = new pg.Pool({
        connectionString,
        ssl: {
            rejectUnauthorized: false,
            requestCert: false
        }
    });


    try {
        console.log("Adding payment_method column to grant_applications...");
        await pool.query('ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS payment_method TEXT;');
        console.log("Column added successfully or already exists.");
    } catch (err) {
        console.error("Error adding column:", err);
    } finally {
        await pool.end();
    }
}

addColumn();
