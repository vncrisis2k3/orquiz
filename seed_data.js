const db = require('./db');

const subjects = [
    { id: 1, name: "Toán" },
    { id: 2, name: "Vật Lý" },
    { id: 3, name: "Hóa Học" },
    { id: 4, name: "Sinh Học" },
    { id: 5, name: "Lịch Sử" },
    { id: 6, name: "Địa Lý" },
    { id: 7, name: "Ngữ Văn" },
    { id: 17, name: "Tiếng Anh" },
    { id: 8, name: "Tin Học" }
];

const grades = [10, 11, 12];

async function seed() {
    try {
        console.log("Starting database seeding...");

        for (const subject of subjects) {
            for (const grade of grades) {
                console.log(`Generating quiz for ${subject.name} - Grade ${grade}...`);
                
                // Create a Quiz
                const quizTitle = `Đề ôn tập ${subject.name} lớp ${grade} - Chuẩn cấu trúc Bộ GD&ĐT`;
                const quizRes = await db.query(
                    'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING id',
                    [quizTitle, subject.id, grade, 30]
                );
                const quizId = quizRes.rows[0].id;

                // Generate 20 questions
                for (let i = 1; i <= 20; i++) {
                    const content = `Câu hỏi số ${i}: Nội dung kiến thức môn ${subject.name} chương ${Math.ceil(i/4)} (Lớp ${grade}). Câu hỏi minh họa cho cấu trúc đề thi trắc nghiệm chuẩn.`;
                    await db.query(
                        'INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                        [
                            quizId, 
                            content,
                            `Đáp án A cho câu ${i}`,
                            `Đáp án B cho câu ${i}`,
                            `Đáp án C cho câu ${i}`,
                            `Đáp án D cho câu ${i}`,
                            ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)],
                            `Giải thích chi tiết cho câu hỏi số ${i} môn ${subject.name}. Áp dụng công thức và lý thuyết đã học trong chương trình lớp ${grade}.`
                        ]
                    );
                }
            }
        }

        console.log("✔ Seeding completed! Added 27 quizzes and 540 questions.");
        process.exit(0);
    } catch (err) {
        console.error("Seeding failed:", err);
        process.exit(1);
    }
}

seed();
