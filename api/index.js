// Mock browser globals for pdf-parse in Node.js environment
global.DOMMatrix = global.DOMMatrix || class DOMMatrix {};
global.ImageData = global.ImageData || class ImageData {};
global.Path2D = global.Path2D || class Path2D {};

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'eduflow_secret';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Middleware to verify JWT
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded.user;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

// Middleware to verify Admin
const adminAuth = async (req, res, next) => {
    try {
        const user = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0 || !user.rows[0].is_admin) {
            return res.status(403).json({ msg: 'Access denied. Admin only.' });
        }
        next();
    } catch (err) {
        console.error("Admin Auth Error:", err);
        res.status(500).json({ msg: 'Server Error in Admin Auth' });
    }
};

// 0. Auth Endpoints
app.post('/api/register', async (req, res) => {
    const { username, email, password, full_name, admin_code } = req.body;
    try {
        const userExists = await db.query('SELECT * FROM users WHERE email = $1 OR username = $2', [email, username]);
        if (userExists.rows.length > 0) return res.status(400).json({ msg: 'User already exists' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Check if registering as admin
        const isAdmin = admin_code && admin_code === (process.env.ADMIN_SECRET || 'EDUFLOW_ADMIN_2026');

        const newUser = await db.query(
            'INSERT INTO users (username, email, password_hash, full_name, is_admin, survey_data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, is_admin',
            [username, email, hashedPassword, full_name, isAdmin, JSON.stringify(req.body.survey)]
        );

        const payload = { user: { id: newUser.rows[0].id } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: 3600 }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: newUser.rows[0] });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) return res.status(400).json({ msg: 'Invalid Credentials' });

        const isMatch = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!isMatch) return res.status(400).json({ msg: 'Invalid Credentials' });

        const payload = { user: { id: user.rows[0].id } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: 3600 }, (err, token) => {
            if (err) throw err;
            res.json({ 
                token, 
                user: { 
                    id: user.rows[0].id, 
                    username: user.rows[0].username, 
                    email: user.rows[0].email,
                    is_admin: user.rows[0].is_admin
                } 
            });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

app.get('/api/auth/user', auth, async (req, res) => {
    try {
        const user = await db.query('SELECT id, username, email, full_name, level, total_points, avatar_url, survey_data, roadmap_data, is_admin FROM users WHERE id = $1', [req.user.id]);
        res.json(user.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 1. Get all subjects
app.get('/api/subjects', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM subjects ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 2. Get quizzes by subject
app.get('/api/quizzes/:subject_id', async (req, res) => {
    const { subject_id } = req.params;
    const grade = req.query.grade;
    try {
        let query = 'SELECT * FROM quizzes WHERE subject_id = $1';
        let params = [subject_id];
        
        if (grade) {
            query += ' AND grade = $2';
            params.push(grade);
        }
        
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 3. Get quiz details and questions
app.get('/api/quiz/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const quiz = await db.query('SELECT * FROM quizzes WHERE id = $1', [id]);
        const questions = await db.query('SELECT * FROM questions WHERE quiz_id = $1', [id]);
        
        if (quiz.rows.length === 0) return res.status(404).json({ msg: 'Quiz not found' });

        res.json({
            ...quiz.rows[0],
            questions: questions.rows
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 4. Submit result
app.post('/api/results', auth, async (req, res) => {
    const { quiz_id, score, correct_count, total_count, time_spent } = req.body;
    const user_id = req.user.id;
    try {
        const newResult = await db.query(
            'INSERT INTO results (user_id, quiz_id, score, correct_answers_count, total_questions, time_spent_seconds) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [user_id, quiz_id, score, correct_count, total_count, time_spent]
        );

        const pointsEarned = correct_count * 10;
        await db.query(
            'UPDATE users SET total_points = total_points + $1 WHERE id = $2',
            [pointsEarned, user_id]
        );

        res.json(newResult.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 5. Get user's quiz history
app.get('/api/results/user', auth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT r.*, q.title as quiz_title, s.name as subject_name 
             FROM results r 
             JOIN quizzes q ON r.quiz_id = q.id 
             JOIN subjects s ON q.subject_id = s.id
             WHERE r.user_id = $1 
             ORDER BY r.completed_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 6. Update User Profile
app.put('/api/users/profile', auth, async (req, res) => {
    const { email, avatar_url, full_name, survey_data } = req.body;
    try {
        const updatedUser = await db.query(
            'UPDATE users SET email = $1, avatar_url = $2, full_name = $3, survey_data = $4 WHERE id = $5 RETURNING id, username, email, full_name, avatar_url, survey_data',
            [email, avatar_url, full_name, JSON.stringify(survey_data), req.user.id]
        );
        res.json(updatedUser.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 7. Admin: User Management
app.get('/api/admin/users', [auth, adminAuth], async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, email, full_name, level, total_points, is_admin FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Admin: Update User
app.put('/api/admin/user/:id', [auth, adminAuth], async (req, res) => {
    const { full_name, level, total_points, is_admin } = req.body;
    try {
        const result = await db.query(
            'UPDATE users SET full_name = $1, level = $2, total_points = $3, is_admin = $4 WHERE id = $5 RETURNING id, username, email, full_name, level, total_points, is_admin',
            [full_name, level, total_points, is_admin, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Admin: Delete User
app.delete('/api/admin/user/:id', [auth, adminAuth], async (req, res) => {
    try {
        // Prevent deleting yourself
        if (req.params.id == req.user.id) {
            return res.status(400).json({ msg: 'Cannot delete your own admin account' });
        }
        await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ msg: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 8. Admin: Quiz Management
app.get('/api/admin/quizzes', [auth, adminAuth], async (req, res) => {
    try {
        const result = await db.query('SELECT q.*, s.name as subject_name FROM quizzes q JOIN subjects s ON q.subject_id = s.id ORDER BY q.id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Admin: Get Quiz Questions
app.get('/api/admin/quiz/:id/questions', [auth, adminAuth], async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM questions WHERE quiz_id = $1 ORDER BY id ASC', [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Admin: Update Quiz
app.put('/api/admin/quiz/:id', [auth, adminAuth], async (req, res) => {
    const { title, subject_id, grade, duration_minutes } = req.body;
    try {
        const result = await db.query(
            'UPDATE quizzes SET title = $1, subject_id = $2, grade = $3, duration_minutes = $4 WHERE id = $5 RETURNING *',
            [title, subject_id, grade, duration_minutes, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 9. Admin: Scan PDF/Word
app.post('/api/admin/scan-quiz', [auth, adminAuth, upload.single('file')], async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const { subject_id, grade, duration } = req.body;
    
    try {
        let text = '';
        if (req.file.mimetype === 'application/pdf') {
            const data = await pdf(req.file.buffer);
            text = data.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer: req.file.buffer });
            text = result.value;
        } else {
            return res.status(400).send('Only PDF and DOCX are supported.');
        }

        if (!text || text.trim().length < 10) {
            throw new Error("Tài liệu không có nội dung hoặc quá ngắn để xử lý.");
        }

        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = `Bạn là một chuyên gia soạn đề thi. Hãy trích xuất các câu hỏi trắc nghiệm từ văn bản sau đây.
        Yêu cầu:
        1. Trả về định dạng JSON là một mảng các đối tượng.
        2. Mỗi đối tượng gồm: "content" (câu hỏi), "option_a", "option_b", "option_c", "option_d", "correct_option" (chỉ ghi chữ cái A, B, C hoặc D), và "explanation" (giải thích ngắn gọn).
        3. Văn bản: ${text}`;

        const result = await model.generateContent(prompt);
        const aiText = result.response.text();

        const jsonMatch = aiText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("Could not parse AI response: No JSON array found");
        
        let questions;
        try {
            questions = JSON.parse(jsonMatch[0]);
        } catch (e) {
            const cleaned = jsonMatch[0].replace(/```json/g, '').replace(/```/g, '').trim();
            questions = JSON.parse(cleaned);
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const newQuiz = await client.query(
                'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *',
                [`Đề Scan: ${req.file.originalname}`, subject_id, grade, duration || 15]
            );
            const quizId = newQuiz.rows[0].id;
            for (const q of questions) {
                await client.query(
                    'INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [quizId, q.content, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation]
                );
            }
            await client.query('COMMIT');
            res.json({ msg: 'Quiz scanned and created', quiz: newQuiz.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Scanning Error:", err);
        res.status(500).json({ msg: 'Scanning Failed: ' + err.message });
    }
});

// 11. Admin: Delete Quiz
app.delete('/api/admin/quiz/:id', [auth, adminAuth], async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM quizzes WHERE id = $1', [id]);
        res.json({ msg: 'Quiz deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// 12. Get Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leaderboard LIMIT 10');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Admin: AI Generate Quiz
app.post('/api/admin/ai-generate-quiz', auth, adminAuth, async (req, res) => {
    const { subject_id, grade, count, subject_name } = req.body;
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = `
            Bạn là một chuyên gia biên soạn đề thi trắc nghiệm theo chuẩn của Bộ Giáo dục và Đào tạo Việt Nam.
            Hãy tạo một bộ đề thi trắc nghiệm môn ${subject_name} lớp ${grade}.
            Số lượng câu hỏi: ${count} câu.
            
            Yêu cầu nội dung:
            - Phân bổ độ khó: 40% Nhận biết, 30% Thông hiểu, 20% Vận dụng, 10% Vận dụng cao.
            - Mỗi câu hỏi phải có 4 phương án lựa chọn (A, B, C, D).
            - Chỉ có duy nhất 1 đáp án đúng.
            - Phải có phần giải thích ngắn gọn cho đáp án đúng.
            
            Định dạng đầu ra: CHỈ TRẢ VỀ JSON MẢNG (không có văn bản giải thích ở đầu hoặc cuối). 
            BẮT BUỘC ĐÚNG ĐỊNH DẠNG JSON. Không sử dụng ký tự đặc biệt gây lỗi JSON.
            [
                {
                    "content": "Nội dung câu hỏi...",
                    "option_a": "...",
                    "option_b": "...",
                    "option_c": "...",
                    "option_d": "...",
                    "correct_option": "A/B/C/D",
                    "explanation": "..."
                }
            ]
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("AI không trả về định dạng mảng JSON hợp lệ.");
        
        let cleanedJson = jsonMatch[0]
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
            .trim();

        cleanedJson = cleanedJson.replace(/,\s*\]/g, ']');
        const questions = JSON.parse(cleanedJson);

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const quizTitle = `Đề ${subject_name} Lớp ${grade} (AI biên soạn)`;
            const newQuiz = await client.query(
                'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *',
                [quizTitle, subject_id, grade, count == 40 ? 50 : 30]
            );
            const quizId = newQuiz.rows[0].id;

            for (const q of questions) {
                await client.query(
                    'INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [quizId, q.content, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation]
                );
            }
            await client.query('COMMIT');
            res.json({ msg: 'Quiz generated successfully', quiz_id: quizId });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("AI Gen Error:", err);
        res.status(500).json({ msg: 'Failed to generate quiz with AI: ' + err.message });
    }
});

// Admin: Manual Quiz Creation
app.post('/api/admin/quiz-manual', [auth, adminAuth], async (req, res) => {
    const { title, subject_id, grade, duration, questions } = req.body;
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const quizRes = await client.query(
            'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING id',
            [title, subject_id, grade, duration]
        );
        const quizId = quizRes.rows[0].id;
        for (const q of questions) {
            await client.query(
                'INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [quizId, q.content, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation]
            );
        }
        await client.query('COMMIT');
        res.json({ msg: 'Quiz created successfully', id: quizId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Manual quiz creation error:", err);
        res.status(500).json({ msg: 'Server Error while creating quiz' });
    } finally {
        client.release();
    }
});

// AI Analysis & Roadmap
app.post('/api/ai/analyze-results', auth, async (req, res) => {
    const { quiz_id, score, correct_count, total_count, userAnswers } = req.body;
    try {
        const quizRes = await db.query(
            'SELECT q.title, s.name as subject_name FROM quizzes q JOIN subjects s ON q.subject_id = s.id WHERE q.id = $1',
            [quiz_id]
        );
        if (quizRes.rows.length === 0) return res.status(404).json({ msg: 'Quiz not found' });
        
        const quiz = quizRes.rows[0];
        const questionsRes = await db.query('SELECT * FROM questions WHERE quiz_id = $1 ORDER BY id ASC', [quiz_id]);
        const questions = questionsRes.rows;

        let weakPoints = [];
        questions.forEach((q, index) => {
            if (userAnswers[index] !== q.correct_option) {
                weakPoints.push({ content: q.content, correct_option: q.correct_option, explanation: q.explanation });
            }
        });

        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = `
        Bạn là một cố vấn học tập AI thông minh. Hãy phân tích kết quả bài thi sau và đưa ra lộ trình học tập.
        THÔNG TIN: Môn: ${quiz.subject_name}, Đề: ${quiz.title}, Điểm: ${Number(score).toFixed(1)}/10, Đúng: ${correct_count}/${total_count}
        CÂU SAI: ${weakPoints.length > 0 ? weakPoints.map((wp, i) => `${i+1}. ${wp.content} (Đáp án: ${wp.correct_option}). ${wp.explanation || ''}`).join('\n') : 'Không sai câu nào.'}
        YÊU CẦU: Nhận xét, chỉ mảng kiến thức hổng, lộ trình 4 tuần, 3 lời khuyên. Tiếng Việt, Markdown.`;

        const result = await model.generateContent(prompt);
        const analysisText = result.response.text();
        if (!analysisText) throw new Error("AI returned empty response");
        res.json({ analysis: analysisText });
    } catch (err) {
        console.error("AI Analysis Error:", err);
        res.status(500).json({ msg: 'AI Analysis Failed', error: err.message });
    }
});

// 15. Generate Personalized Study Roadmap
app.post('/api/roadmap/generate', auth, async (req, res) => {
    try {
        const userRes = await db.query('SELECT survey_data, roadmap_data FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];
        const survey = typeof user.survey_data === 'string' ? JSON.parse(user.survey_data) : (user.survey_data || {});

        const resultsRes = await db.query(`
            SELECT r.score, r.correct_answers_count, r.total_questions, q.title, s.name as subject_name 
            FROM results r JOIN quizzes q ON r.quiz_id = q.id JOIN subjects s ON q.subject_id = s.id 
            WHERE r.user_id = $1 ORDER BY r.completed_at DESC LIMIT 5
        `, [req.user.id]);

        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = `
            Xây dựng LỘ TRÌNH HỌC TẬP 4 tuần cho học sinh:
            Lớp: ${survey.grade || '?'}, Ban: ${survey.stream || '?'}, Mục tiêu: ${survey.goal || 'Nâng cao'}
            Thế mạnh: ${Array.isArray(survey.strengths) ? survey.strengths.join(', ') : (survey.strengths || '?')}
            Yếu: ${Array.isArray(survey.weaknesses) ? survey.weaknesses.join(', ') : (survey.weaknesses || '?')}
            Kết quả gần đây: ${resultsRes.rows.length > 0 ? resultsRes.rows.map(r => `${r.title} (${r.subject_name}): ${r.score}/10`).join('\n') : 'Chưa có.'}
            Chia 4 tuần rõ ràng, Markdown, tiếng Việt.`;

        const result = await model.generateContent(prompt);
        const roadmapText = result.response.text();
        await db.query('UPDATE users SET roadmap_data = $1 WHERE id = $2', [roadmapText, req.user.id]);
        res.json({ msg: 'Roadmap generated', roadmap: roadmapText });
    } catch (err) {
        console.error("Roadmap Gen Error:", err);
        res.status(500).json({ msg: 'Failed to generate roadmap', error: err.message });
    }
});

module.exports = app;
