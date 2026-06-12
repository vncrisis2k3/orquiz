const db = require('./db');

const schema = `
-- 1. Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(100),
    level INT DEFAULT 1,
    total_points INT DEFAULT 0,
    avatar_url TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    survey_data JSONB,
    roadmap_data TEXT,
    current_streak INT DEFAULT 0,
    longest_streak INT DEFAULT 0,
    last_activity_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Đảm bảo các cột tồn tại nếu bảng đã lỡ tạo trước đó
ALTER TABLE users ADD COLUMN IF NOT EXISTS survey_data JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS roadmap_data TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longest_streak INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_date DATE;

-- 3. Quizzes Table
CREATE TABLE IF NOT EXISTS quizzes (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    subject_id INT REFERENCES subjects(id),
    grade INT CHECK (grade IN (10, 11, 12)),
    duration_minutes INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Questions Table
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    quiz_id INT REFERENCES quizzes(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_option CHAR(1) CHECK (correct_option IN ('A', 'B', 'C', 'D')),
    explanation TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Results Table
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    quiz_id INT REFERENCES quizzes(id) ON DELETE CASCADE,
    score FLOAT NOT NULL,
    correct_answers_count INT,
    total_questions INT,
    time_spent_seconds INT,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index and View
CREATE INDEX IF NOT EXISTS idx_user_total_points ON users(total_points DESC);
CREATE OR REPLACE VIEW leaderboard AS
SELECT id, username, full_name, total_points, level,
RANK() OVER (ORDER BY total_points DESC) as rank_position
FROM users;
`;

const seedData = `
-- Seed Subjects
INSERT INTO subjects (name, slug) VALUES 
('Toán', 'toan'), ('Vật Lý', 'ly'), ('Hóa Học', 'hoa'), 
('Sinh Học', 'sinh'), ('Lịch Sử', 'su'), ('Địa Lý', 'dia'), 
('Ngữ Văn', 'van'), ('Tin Học', 'tin'), ('Tiếng Anh', 'anh')
ON CONFLICT (slug) DO NOTHING;

-- Seed a Sample User (Password: admin123)
INSERT INTO users (username, email, password_hash, full_name, level, total_points, is_admin)
VALUES ('admin', 'admin@eduflow.com', '$2a$10$7R8jZ/G.3x.3fK1G5C5.ueR6N3xY3R3R3R3R3R3R3R3R3R3R3R3R', 'Admin EduFlow', 10, 5000, TRUE)
ON CONFLICT (username) DO NOTHING;

-- Seed a Sample Quiz (Toán 12)
INSERT INTO quizzes (title, subject_id, grade, duration_minutes)
VALUES ('Kiểm tra Đạo hàm - Toán 12', 1, 12, 15)
RETURNING id;
`;

const seedQuestions = (quizId) => `
INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation)
VALUES 
(${quizId}, 'Đạo hàm của hàm số y = x^3 là?', '3x', '3x^2', 'x^2', '3x^3', 'B', 'Công thức đạo hàm (x^n)'' = n*x^(n-1)'),
(${quizId}, 'Giá trị cực tiểu của hàm số y = x^2 - 4x + 3 là?', '1', '-1', '3', '0', 'B', 'Đạo hàm y'' = 2x - 4 = 0 => x = 2. Thay x=2 vào y ta được 4-8+3 = -1.');
`;

async function setup() {
    try {
        console.log("Starting database setup...");

        // Run Schema
        await db.query(schema);
        console.log("✔ Tables and Views created.");

        // Run Seed Data
        const seedResult = await db.query(seedData);
        console.log("✔ Subjects and Sample User seeded.");

        if (seedResult[2] && seedResult[2].rows && seedResult[2].rows.length > 0) {
            const quizId = seedResult[2].rows[0].id;
            await db.query(seedQuestions(quizId));
            console.log("✔ Sample Quiz and Questions seeded.");
        }

        console.log("Database setup completed successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Error during setup:", err);
        process.exit(1);
    }
}

setup();
