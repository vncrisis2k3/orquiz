const db = require('./db');

async function verify() {
    try {
        const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='survey_data';");
        if (res.rows.length > 0) {
            console.log("✔ survey_data column exists.");
        } else {
            console.log("✘ survey_data column MISSING. Attempting to add again...");
            await db.query("ALTER TABLE users ADD COLUMN survey_data JSONB;");
            console.log("✔ Column added successfully.");
        }
        process.exit(0);
    } catch (err) {
        console.error("Verification failed:", err);
        process.exit(1);
    }
}

verify();
