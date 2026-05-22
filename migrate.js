const db = require('./db');

async function migrate() {
    try {
        console.log("Migrating database...");
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS survey_data JSONB;");
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS roadmap_data TEXT;");
        console.log("✔ Columns survey_data and roadmap_data added to users table.");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
