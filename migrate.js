const db = require('./db');

async function migrate() {
    try {
        console.log("Migrating database...");
        
        // 1. Existing user table migrations
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS survey_data JSONB;");
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS roadmap_data TEXT;");
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak INT DEFAULT 0;");
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS longest_streak INT DEFAULT 0;");
        await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_date DATE;");
        console.log("✔ User table columns updated.");

        // 2. Create topics table
        await db.query(`
            CREATE TABLE IF NOT EXISTS topics (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                subject_id INT REFERENCES subjects(id) ON DELETE CASCADE,
                grade INT CHECK (grade IN (10, 11, 12)),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✔ Topics table created.");

        // 3. Add columns to quizzes table
        await db.query("ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS topic_id INT REFERENCES topics(id) ON DELETE SET NULL;");
        await db.query("ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS is_practice BOOLEAN DEFAULT FALSE;");
        console.log("✔ Quizzes table updated with topic_id and is_practice columns.");

        // 3b. Support numeric fill-in-the-blank questions while preserving old A-D questions
        await db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(30) NOT NULL DEFAULT 'multiple_choice';");
        await db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_answer TEXT;");
        await db.query("UPDATE questions SET question_type = 'multiple_choice' WHERE question_type IS NULL;");
        console.log("✔ Questions updated with fill-in-the-blank support.");

        // 4. Seed subjects if not already seeded
        const subjectsResult = await db.query("SELECT * FROM subjects;");
        if (subjectsResult.rows.length === 0) {
            await db.query(`
                INSERT INTO subjects (name, slug) VALUES 
                ('Toán', 'toan'), ('Vật Lý', 'ly'), ('Hóa Học', 'hoa'), 
                ('Sinh Học', 'sinh'), ('Lịch Sử', 'su'), ('Địa Lý', 'dia'), 
                ('Ngữ Văn', 'van'), ('Tin Học', 'tin'), ('Tiếng Anh', 'anh')
                ON CONFLICT (slug) DO NOTHING;
            `);
            console.log("✔ Subjects seeded.");
        }

        // Get subjects lookup map
        const subjects = await db.query("SELECT id, slug FROM subjects;");
        const subMap = {};
        subjects.rows.forEach(s => {
            subMap[s.slug] = s.id;
        });

        // 5. Seed default topics for major subjects and grades
        const defaultTopics = [
            // Toán
            { subject: 'toan', grade: 10, name: 'Mệnh đề và Tập hợp' },
            { subject: 'toan', grade: 10, name: 'Hàm số bậc hai và Đồ thị' },
            { subject: 'toan', grade: 10, name: 'Hệ thức lượng trong tam giác' },
            { subject: 'toan', grade: 11, name: 'Hàm số lượng giác và Phương trình lượng giác' },
            { subject: 'toan', grade: 11, name: 'Dãy số, Cấp số cộng và Cấp số nhân' },
            { subject: 'toan', grade: 11, name: 'Giới hạn và Hàm số liên tục' },
            { subject: 'toan', grade: 12, name: 'Hàm số và Ứng dụng đạo hàm' },
            { subject: 'toan', grade: 12, name: 'Nguyên hàm, Tích phân và Ứng dụng' },
            { subject: 'toan', grade: 12, name: 'Số phức' },

            // Vật lý
            { subject: 'ly', grade: 10, name: 'Động học chất điểm' },
            { subject: 'ly', grade: 10, name: 'Động lực học chất điểm' },
            { subject: 'ly', grade: 11, name: 'Điện tích và Điện trường' },
            { subject: 'ly', grade: 11, name: 'Dòng điện không đổi' },
            { subject: 'ly', grade: 12, name: 'Dao động cơ' },
            { subject: 'ly', grade: 12, name: 'Sóng cơ và Sóng âm' },
            { subject: 'ly', grade: 12, name: 'Dòng điện xoay chiều' },

            // Hóa học
            { subject: 'hoa', grade: 10, name: 'Cấu tạo nguyên tử' },
            { subject: 'hoa', grade: 10, name: 'Bảng tuần hoàn các nguyên tố hóa học' },
            { subject: 'hoa', grade: 11, name: 'Cân bằng hóa học' },
            { subject: 'hoa', grade: 11, name: 'Sự điện li' },
            { subject: 'hoa', grade: 12, name: 'Este và Lipit' },
            { subject: 'hoa', grade: 12, name: 'Cacbohidrat' },
            { subject: 'hoa', grade: 12, name: 'Amin, Amino Axit và Protein' },

            // Tiếng Anh
            { subject: 'anh', grade: 10, name: 'Grammar: Tenses' },
            { subject: 'anh', grade: 10, name: 'Vocabulary: Family Life' },
            { subject: 'anh', grade: 11, name: 'Grammar: Gerunds and Infinitives' },
            { subject: 'anh', grade: 11, name: 'Vocabulary: Generation Gap' },
            { subject: 'anh', grade: 12, name: 'Grammar: Passive Voice & Relative Clauses' },
            { subject: 'anh', grade: 12, name: 'Vocabulary: Life Stories' }
        ];

        for (const t of defaultTopics) {
            const subjectId = subMap[t.subject];
            if (subjectId) {
                // Check if topic exists
                const checkTopic = await db.query(
                    "SELECT id FROM topics WHERE name = $1 AND subject_id = $2 AND grade = $3",
                    [t.name, subjectId, t.grade]
                );
                if (checkTopic.rows.length === 0) {
                    await db.query(
                        "INSERT INTO topics (name, subject_id, grade) VALUES ($1, $2, $3)",
                        [t.name, subjectId, t.grade]
                    );
                }
            }
        }
        console.log("✔ Default topics seeded.");

        // 6. Associate existing quizzes with some topic and set is_practice where appropriate
        // If a quiz is styled as "Kiểm tra...", we can keep it as is_practice = false.
        // If we want practice quizzes, we can mark some or all of them.
        await db.query("UPDATE quizzes SET is_practice = TRUE WHERE title ILIKE '%luyện%' OR title ILIKE '%ôn%';");
        
        // Associate quizzes with topics if they match
        const quizzes = await db.query("SELECT id, title, subject_id, grade FROM quizzes;");
        for (const q of quizzes.rows) {
            // Find a topic for the same subject and grade
            const matchingTopic = await db.query(
                "SELECT id FROM topics WHERE subject_id = $1 AND grade = $2 LIMIT 1",
                [q.subject_id, q.grade]
            );
            if (matchingTopic.rows.length > 0) {
                await db.query(
                    "UPDATE quizzes SET topic_id = $1 WHERE id = $2 AND topic_id IS NULL",
                    [matchingTopic.rows[0].id, q.id]
                );
            }
        }
        console.log("✔ Associated existing quizzes with topics.");

        console.log("Database migration completed successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
