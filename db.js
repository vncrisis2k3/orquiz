const { Pool } = require('pg');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
    // Production: Use connection string (Neon / Vercel Postgres / Supabase)
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 1,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
        allowExitOnIdle: true,
    });
} else {
    // Local development: Use individual env vars
    pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });
}

pool.on('connect', () => {
    console.log('Connected to PostgreSQL Database');
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool: pool
};
