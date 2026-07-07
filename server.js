// v2 - fix: duration_minutes uses 0 for practice quizzes
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'eduflow_secret';
let geminiApiKey = process.env.GEMINI_API_KEY || '';
let geminiApiKeySource = geminiApiKey ? 'environment' : 'none';
let geminiSettingsLoaded = false;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });
let pdfParser;
let mammothParser;

function getPdfParser() {
    if (!pdfParser) {
        // pdf-parse needs these browser-like globals in the Node.js runtime.
        global.DOMMatrix = global.DOMMatrix || class DOMMatrix {};
        global.ImageData = global.ImageData || class ImageData {};
        global.Path2D = global.Path2D || class Path2D {};
        pdfParser = require('pdf-parse').PDFParse;
    }
    return pdfParser;
}

async function parsePdfBuffer(buffer) {
    const PDFParse = getPdfParser();
    const parser = new PDFParse({ data: buffer });
    try {
        return await parser.getText();
    } finally {
        await parser.destroy();
    }
}

function getMammothParser() {
    if (!mammothParser) {
        mammothParser = require('mammoth');
    }
    return mammothParser;
}

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

async function ensureSystemSettingsTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function loadGeminiApiKey() {
    if (geminiSettingsLoaded) return geminiApiKey;

    await ensureSystemSettingsTable();
    const result = await db.query(
        'SELECT setting_value FROM system_settings WHERE setting_key = $1',
        ['gemini_api_key']
    );
    if (result.rows[0]?.setting_value) {
        geminiApiKey = result.rows[0].setting_value;
        geminiApiKeySource = 'database';
    }
    geminiSettingsLoaded = true;
    return geminiApiKey;
}

async function getGeminiClient() {
    const apiKey = await loadGeminiApiKey();
    if (!apiKey) {
        throw new Error('Gemini API key chưa được cấu hình.');
    }
    return new GoogleGenerativeAI(apiKey);
}

function maskApiKey(apiKey) {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return '********';
    return `${apiKey.slice(0, 4)}${'*'.repeat(Math.min(20, apiKey.length - 8))}${apiKey.slice(-4)}`;
}

function repairUtf8Mojibake(value) {
    if (typeof value !== 'string' || !/[ÃÂÄÆÐáºá»]/.test(value)) {
        return value;
    }

    const repaired = Buffer.from(value, 'latin1').toString('utf8');
    return repaired.includes('\uFFFD') ? value : repaired.normalize('NFC');
}

// 0. Auth Endpoints
app.post('/api/register', async (req, res) => {
    const { username, email, password, full_name, admin_code, isGoogleRegister, avatar_url } = req.body;
    try {
        const userExists = await db.query('SELECT * FROM users WHERE email = $1 OR username = $2', [email, username]);
        if (userExists.rows.length > 0) return res.status(400).json({ msg: 'Email hoặc tên đăng nhập đã được sử dụng.' });

        let hashedPassword;
        if (isGoogleRegister) {
            const salt = await bcrypt.genSalt(10);
            const randomPass = Math.random().toString(36).slice(-10);
            hashedPassword = await bcrypt.hash(randomPass, salt);
        } else {
            const salt = await bcrypt.genSalt(10);
            hashedPassword = await bcrypt.hash(password, salt);
        }

        const isAdmin = admin_code && admin_code === (process.env.ADMIN_SECRET || 'EDUFLOW_ADMIN_2026');

        const newUser = await db.query(
            'INSERT INTO users (username, email, password_hash, full_name, avatar_url, is_admin, survey_data) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email, is_admin',
            [username, email, hashedPassword, full_name, avatar_url || null, isAdmin, JSON.stringify(req.body.survey)]
        );

        const payload = { user: { id: newUser.rows[0].id } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: 3600 }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: newUser.rows[0] });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Lỗi máy chủ khi đăng ký.' });
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

app.post('/api/auth/reset-password', async (req, res) => {
    const { email, username, new_password } = req.body;
    try {
        const user = await db.query('SELECT * FROM users WHERE email = $1 AND username = $2', [email, username]);
        if (user.rows.length === 0) {
            return res.status(400).json({ msg: 'Email hoặc tên đăng nhập không chính xác.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, user.rows[0].id]);
        res.json({ msg: 'Đặt lại mật khẩu thành công.' });
    } catch (err) {
        console.error("Reset Password Error:", err.message);
        res.status(500).json({ msg: 'Lỗi máy chủ khi đặt lại mật khẩu.' });
    }
});

app.post('/api/auth/change-password', auth, async (req, res) => {
    const { current_password, new_password } = req.body;
    try {
        const user = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'Không tìm thấy người dùng.' });
        }

        const isMatch = await bcrypt.compare(current_password, user.rows[0].password_hash);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Mật khẩu hiện tại không chính xác.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        res.json({ msg: 'Thay đổi mật khẩu thành công.' });
    } catch (err) {
        console.error("Change Password Error:", err.message);
        res.status(500).json({ msg: 'Lỗi máy chủ khi đổi mật khẩu.' });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    });
});

app.post('/api/auth/google', async (req, res) => {
    const { credential, isMock, mockData } = req.body;
    try {
        let email, name, avatar_url, googleId;

        if (isMock) {
            email = mockData.email || 'student@gmail.com';
            name = mockData.name || 'Học viên Demo';
            avatar_url = mockData.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120';
            googleId = mockData.sub || 'mock_google_id_123456';
        } else {
            const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
            if (!verifyRes.ok) {
                return res.status(400).json({ msg: 'Token Google không hợp lệ hoặc đã hết hạn.' });
            }
            const payload = await verifyRes.json();
            email = payload.email;
            name = payload.name;
            avatar_url = payload.picture;
            googleId = payload.sub;
        }

        const userRes = await db.query('SELECT * FROM users WHERE email = $1', [email]);

        // --- EXISTING USER: log them in directly ---
        if (userRes.rows.length > 0) {
            const user = userRes.rows[0];
            // Update avatar if missing
            if (!user.avatar_url && avatar_url) {
                await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatar_url, user.id]);
                user.avatar_url = avatar_url;
            }
            const payload = { user: { id: user.id } };
            jwt.sign(payload, JWT_SECRET, { expiresIn: 3600 }, (err, token) => {
                if (err) throw err;
                res.json({
                    token,
                    exists: true,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        is_admin: user.is_admin
                    }
                });
            });
        } else {
            // --- NEW USER: do NOT create yet. Return Google data so
            //     frontend can show the competency survey. The actual
            //     account will be created by /api/register after survey. ---
            res.json({
                exists: false,
                googleData: { email, name, picture: avatar_url }
            });
        }
    } catch (err) {
        console.error("Google SSO Error:", err.message);
        res.status(500).json({ msg: 'Lỗi hệ thống khi đăng nhập Google.' });
    }
});

app.get('/api/auth/user', auth, async (req, res) => {
    try {
        const user = await db.query('SELECT id, username, email, full_name, level, total_points, avatar_url, survey_data, roadmap_data, is_admin, current_streak, longest_streak, last_activity_date FROM users WHERE id = $1', [req.user.id]);
        res.json(user.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Get streak info for current user
app.get('/api/streak', auth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT current_streak, longest_streak, last_activity_date FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json(result.rows[0]);
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

// Topics endpoints
app.get('/api/topics', async (req, res) => {
    const { subject_id, grade } = req.query;
    try {
        let query = 'SELECT * FROM topics';
        let params = [];
        if (subject_id && grade) {
            query += ' WHERE subject_id = $1 AND grade = $2';
            params = [subject_id, grade];
        } else if (subject_id) {
            query += ' WHERE subject_id = $1';
            params = [subject_id];
        } else if (grade) {
            query += ' WHERE grade = $1';
            params = [grade];
        }
        query += ' ORDER BY id ASC';
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

app.post('/api/admin/topics', [auth, adminAuth], async (req, res) => {
    const { name, subject_id, grade } = req.body;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedSubjectId = Number(subject_id);
    const normalizedGrade = Number(grade);
    if (!normalizedName || !Number.isInteger(normalizedSubjectId) || ![10, 11, 12].includes(normalizedGrade)) {
        return res.status(400).json({ msg: 'Vui lòng nhập đầy đủ thông tin chủ đề.' });
    }
    try {
        const result = await db.query(
            'INSERT INTO topics (name, subject_id, grade) VALUES ($1, $2, $3) RETURNING *',
            [normalizedName, normalizedSubjectId, normalizedGrade]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        if (err.code === '23503') {
            return res.status(400).json({ msg: 'Môn học không tồn tại.' });
        }
        res.status(500).json({ msg: 'Server Error' });
    }
});

app.put('/api/admin/topics/:id', [auth, adminAuth], async (req, res) => {
    const id = Number(req.params.id);
    const { name, subject_id, grade } = req.body;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedSubjectId = Number(subject_id);
    const normalizedGrade = Number(grade);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ msg: 'ID chủ đề không hợp lệ.' });
    }
    if (!normalizedName || !Number.isInteger(normalizedSubjectId) || ![10, 11, 12].includes(normalizedGrade)) {
        return res.status(400).json({ msg: 'Vui lòng nhập đầy đủ thông tin chủ đề.' });
    }

    try {
        const result = await db.query(
            `UPDATE topics
             SET name = $1, subject_id = $2, grade = $3
             WHERE id = $4
             RETURNING *`,
            [normalizedName, normalizedSubjectId, normalizedGrade, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ msg: 'Không tìm thấy chủ đề.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        if (err.code === '23503') {
            return res.status(400).json({ msg: 'Môn học không tồn tại.' });
        }
        res.status(500).json({ msg: 'Server Error' });
    }
});

app.delete('/api/admin/topics/:id', [auth, adminAuth], async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ msg: 'ID chủ đề không hợp lệ.' });
    }
    try {
        const result = await db.query('DELETE FROM topics WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ msg: 'Không tìm thấy chủ đề.' });
        }
        res.json({ msg: 'Đã xóa chủ đề thành công.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

const SKILL_TREE_PASS_SCORE = 5;

async function buildSkillTree(userId, subjectId, grade) {
    const subjectResult = await db.query(
        'SELECT id, name, slug FROM subjects WHERE id = $1',
        [subjectId]
    );
    if (subjectResult.rows.length === 0) return null;

    const [topicsResult, quizzesResult] = await Promise.all([
        db.query(
            `SELECT id, name
             FROM topics
             WHERE subject_id = $1 AND grade = $2
             ORDER BY id ASC`,
            [subjectId, grade]
        ),
        db.query(
            `SELECT q.id, q.title, q.topic_id, q.duration_minutes, q.is_practice,
                    COALESCE(MAX(r.score), 0) AS best_score,
                    COUNT(DISTINCT r.id)::int AS attempts,
                    COUNT(DISTINCT question.id)::int AS question_count
             FROM quizzes q
             LEFT JOIN results r ON r.quiz_id = q.id AND r.user_id = $3
             LEFT JOIN questions question ON question.quiz_id = q.id
             WHERE q.subject_id = $1 AND q.grade = $2
             GROUP BY q.id
             ORDER BY q.id ASC`,
            [subjectId, grade, userId]
        )
    ]);

    const quizzesByTopic = new Map();
    const generalQuizzes = [];
    for (const quiz of quizzesResult.rows) {
        // Skill Tree nodes are intentionally bite-sized: 10-15 questions.
        // Longer quizzes are capped to 15 on the client; shorter drafts stay unavailable.
        if (Number(quiz.question_count) < 10) continue;
        if (quiz.topic_id) {
            if (!quizzesByTopic.has(Number(quiz.topic_id))) {
                quizzesByTopic.set(Number(quiz.topic_id), []);
            }
            quizzesByTopic.get(Number(quiz.topic_id)).push(quiz);
        } else {
            generalQuizzes.push(quiz);
        }
    }

    const rawNodes = [];
    for (const topic of topicsResult.rows) {
        const topicQuizzes = quizzesByTopic.get(Number(topic.id)) || [];
        if (topicQuizzes.length === 0) {
            rawNodes.push({
                key: `topic-${topic.id}`,
                topic_id: topic.id,
                topic_name: topic.name,
                quiz_id: null,
                title: topic.name,
                unavailable: true,
                best_score: null,
                attempts: 0
            });
            continue;
        }

        topicQuizzes.forEach((quiz, index) => {
            rawNodes.push({
                key: `quiz-${quiz.id}`,
                topic_id: topic.id,
                topic_name: topic.name,
                quiz_id: quiz.id,
                title: topicQuizzes.length > 1 ? `${topic.name} · Bài ${index + 1}` : topic.name,
                quiz_title: quiz.title,
                duration_minutes: quiz.duration_minutes,
                question_count: Math.min(15, Number(quiz.question_count)),
                best_score: Number(quiz.best_score || 0),
                attempts: Number(quiz.attempts || 0),
                unavailable: false
            });
        });
    }

    generalQuizzes.forEach((quiz, index) => {
        rawNodes.push({
            key: `quiz-${quiz.id}`,
            topic_id: null,
            topic_name: 'Ôn tập tổng hợp',
            quiz_id: quiz.id,
            title: generalQuizzes.length > 1 ? `Ôn tập tổng hợp · Bài ${index + 1}` : 'Ôn tập tổng hợp',
            quiz_title: quiz.title,
            duration_minutes: quiz.duration_minutes,
            question_count: Math.min(15, Number(quiz.question_count)),
            best_score: Number(quiz.best_score || 0),
            attempts: Number(quiz.attempts || 0),
            unavailable: false
        });
    });

    let previousActionablePassed = true;
    let completed = 0;
    let actionableCount = 0;
    const nodes = rawNodes.map((node) => {
        if (node.unavailable) return { ...node, status: 'unavailable', unlocked: false, passed: false };

        actionableCount++;
        const passed = node.best_score >= SKILL_TREE_PASS_SCORE;
        const unlocked = previousActionablePassed;
        const effectivePassed = unlocked && passed;
        const status = effectivePassed ? 'completed' : (unlocked ? 'current' : 'locked');
        if (effectivePassed) completed++;
        previousActionablePassed = effectivePassed;
        return { ...node, status, unlocked, passed };
    });

    return {
        subject: subjectResult.rows[0],
        grade,
        pass_score: SKILL_TREE_PASS_SCORE,
        completed,
        total: actionableCount,
        progress_percent: actionableCount ? Math.round((completed / actionableCount) * 100) : 0,
        nodes
    };
}

app.get('/api/skill-tree', auth, async (req, res) => {
    const subjectId = Number(req.query.subject_id);
    const grade = Number(req.query.grade);
    if (!Number.isInteger(subjectId) || ![10, 11, 12].includes(grade)) {
        return res.status(400).json({ msg: 'Môn học hoặc lớp không hợp lệ.' });
    }

    try {
        const tree = await buildSkillTree(req.user.id, subjectId, grade);
        if (!tree) return res.status(404).json({ msg: 'Không tìm thấy môn học.' });
        res.json(tree);
    } catch (err) {
        console.error('Skill tree error:', err.message);
        res.status(500).json({ msg: 'Không thể tải bản đồ học tập.' });
    }
});

app.get('/api/skill-tree/access/:quizId', auth, async (req, res) => {
    const quizId = Number(req.params.quizId);
    if (!Number.isInteger(quizId) || quizId <= 0) {
        return res.status(400).json({ msg: 'Bài học không hợp lệ.' });
    }

    try {
        const quizResult = await db.query(
            'SELECT id, subject_id, grade FROM quizzes WHERE id = $1',
            [quizId]
        );
        if (quizResult.rows.length === 0) {
            return res.status(404).json({ msg: 'Không tìm thấy bài học.' });
        }

        const quiz = quizResult.rows[0];
        const tree = await buildSkillTree(req.user.id, Number(quiz.subject_id), Number(quiz.grade));
        const node = tree.nodes.find(item => Number(item.quiz_id) === quizId);
        const unlocked = Boolean(node && node.unlocked);
        res.json({
            unlocked,
            status: node?.status || 'locked',
            subject_id: quiz.subject_id,
            grade: quiz.grade,
            pass_score: SKILL_TREE_PASS_SCORE,
            msg: unlocked ? null : 'Bạn cần hoàn thành trạm trước với ít nhất 5 điểm.'
        });
    } catch (err) {
        console.error('Skill tree access error:', err.message);
        res.status(500).json({ msg: 'Không thể kiểm tra quyền truy cập bài học.' });
    }
});

// 2. Get quizzes by subject
app.get('/api/quizzes/:subject_id', async (req, res) => {
    const { subject_id } = req.params;
    const { grade, is_practice, topic_id } = req.query;
    try {
        let query = `
            SELECT q.*, t.name as topic_name 
            FROM quizzes q
            LEFT JOIN topics t ON q.topic_id = t.id
            WHERE q.subject_id = $1
        `;
        let params = [subject_id];
        
        if (grade) {
            query += ' AND q.grade = $' + (params.length + 1);
            params.push(grade);
        }
        if (is_practice !== undefined) {
            query += ' AND q.is_practice = $' + (params.length + 1);
            params.push(is_practice === 'true' || is_practice === true);
        }
        if (topic_id) {
            query += ' AND q.topic_id = $' + (params.length + 1);
            params.push(topic_id);
        }

        query += ' ORDER BY q.id ASC';
        
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

// Helper: Update daily streak for a user
async function updateStreak(user_id) {
    const userRes = await db.query(
        'SELECT current_streak, longest_streak, last_activity_date FROM users WHERE id = $1',
        [user_id]
    );
    const user = userRes.rows[0];

    // Use local date (YYYY-MM-DD) to avoid UTC offset issues
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // last_activity_date from PostgreSQL DATE column comes as a Date object or ISO string
    // Normalize to YYYY-MM-DD string
    let lastDateStr = null;
    if (user.last_activity_date) {
        const d = new Date(user.last_activity_date);
        // PostgreSQL DATE is stored without timezone, add 12h to avoid UTC midnight rollback
        d.setHours(d.getHours() + 12);
        lastDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    let newStreak = user.current_streak || 0;

    if (!lastDateStr) {
        // First time activity
        newStreak = 1;
    } else if (lastDateStr === todayStr) {
        // Already recorded today - do nothing
        return { current_streak: newStreak, longest_streak: user.longest_streak || 0, streakUpdated: false };
    } else {
        // Calculate difference in days using date strings
        const lastDate = new Date(lastDateStr);
        const today = new Date(todayStr);
        const diffDays = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            // Consecutive day
            newStreak += 1;
        } else {
            // Streak broken (missed one or more days)
            newStreak = 1;
        }
    }

    const newLongest = Math.max(newStreak, user.longest_streak || 0);
    await db.query(
        'UPDATE users SET current_streak = $1, longest_streak = $2, last_activity_date = $3 WHERE id = $4',
        [newStreak, newLongest, todayStr, user_id]
    );
    return { current_streak: newStreak, longest_streak: newLongest, streakUpdated: true };
}

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

        // Update daily streak
        const streakInfo = await updateStreak(user_id);

        res.json({ ...newResult.rows[0], ...streakInfo });
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
        const result = await db.query(`
            SELECT q.*, s.name as subject_name, t.name as topic_name 
            FROM quizzes q 
            JOIN subjects s ON q.subject_id = s.id 
            LEFT JOIN topics t ON q.topic_id = t.id 
            ORDER BY q.id DESC
        `);
        const quizzes = await Promise.all(result.rows.map(async (quiz) => {
            const repairedTitle = repairUtf8Mojibake(quiz.title);
            if (repairedTitle !== quiz.title) {
                await db.query('UPDATE quizzes SET title = $1 WHERE id = $2', [repairedTitle, quiz.id]);
            }
            return {
                ...quiz,
                title: repairedTitle,
                subject_name: repairUtf8Mojibake(quiz.subject_name),
                topic_name: quiz.topic_name ? repairUtf8Mojibake(quiz.topic_name) : null
            };
        }));
        res.json(quizzes);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

// Admin: Dashboard Statistics
app.get('/api/admin/dashboard-stats', [auth, adminAuth], async (req, res) => {
    try {
        const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
        const quizzesCount = await db.query('SELECT COUNT(*) as count FROM quizzes');
        const resultsCount = await db.query('SELECT COUNT(*) as count FROM results');
        const avgScore = await db.query('SELECT AVG(score) as avg FROM results');

        // Attempts per day in the last 7 days
        const attemptsDaily = await db.query(`
            SELECT TO_CHAR(completed_at, 'YYYY-MM-DD') as date, COUNT(*) as count 
            FROM results 
            WHERE completed_at >= NOW() - INTERVAL '7 days' 
            GROUP BY TO_CHAR(completed_at, 'YYYY-MM-DD') 
            ORDER BY date ASC
        `);

        // Average score per subject
        const scoresSubject = await db.query(`
            SELECT s.name as subject_name, ROUND(AVG(r.score)::numeric, 2) as avg_score
            FROM results r
            JOIN quizzes q ON r.quiz_id = q.id
            JOIN subjects s ON q.subject_id = s.id
            GROUP BY s.name
        `);

        // Attempts per subject
        const attemptsSubject = await db.query(`
            SELECT s.name as subject_name, COUNT(*) as count
            FROM results r
            JOIN quizzes q ON r.quiz_id = q.id
            JOIN subjects s ON q.subject_id = s.id
            GROUP BY s.name
        `);

        // Score distribution
        const scoreDist = await db.query(`
            SELECT 
              COUNT(CASE WHEN score < 5.0 THEN 1 END) as weak,
              COUNT(CASE WHEN score >= 5.0 AND score < 6.5 THEN 1 END) as average,
              COUNT(CASE WHEN score >= 6.5 AND score < 8.0 THEN 1 END) as good,
              COUNT(CASE WHEN score >= 8.0 THEN 1 END) as excellent
            FROM results
        `);

        // Recent attempts
        const recentAttempts = await db.query(`
            SELECT r.id, u.username, q.id as quiz_id, q.title as quiz_title, r.score,
                   TO_CHAR(r.completed_at, 'HH24:MI DD/MM') as date
            FROM results r
            JOIN users u ON r.user_id = u.id
            JOIN quizzes q ON r.quiz_id = q.id
            ORDER BY r.completed_at DESC
            LIMIT 5
        `);

        const repairedRecentAttempts = await Promise.all(recentAttempts.rows.map(async (attempt) => {
            const repairedTitle = repairUtf8Mojibake(attempt.quiz_title);
            if (repairedTitle !== attempt.quiz_title) {
                await db.query('UPDATE quizzes SET title = $1 WHERE id = $2', [repairedTitle, attempt.quiz_id]);
            }
            return { ...attempt, quiz_title: repairedTitle };
        }));

        res.json({
            users: parseInt(usersCount.rows[0].count || 0),
            quizzes: parseInt(quizzesCount.rows[0].count || 0),
            attempts: parseInt(resultsCount.rows[0].count || 0),
            avgScore: parseFloat(avgScore.rows[0].avg || 0).toFixed(1),
            attemptsDaily: attemptsDaily.rows,
            scoresSubject: scoresSubject.rows,
            attemptsSubject: attemptsSubject.rows,
            scoreDist: scoreDist.rows[0],
            recentAttempts: repairedRecentAttempts
        });
    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ msg: 'Server Error loading dashboard stats' });
    }
});

app.get('/api/admin/settings/gemini', [auth, adminAuth], async (req, res) => {
    try {
        const apiKey = await loadGeminiApiKey();
        res.json({
            configured: Boolean(apiKey),
            masked_key: maskApiKey(apiKey),
            source: geminiApiKeySource
        });
    } catch (err) {
        console.error('Load Gemini Settings Error:', err);
        res.status(500).json({ msg: 'Không thể tải cấu hình Gemini.' });
    }
});

app.put('/api/admin/settings/gemini', [auth, adminAuth], async (req, res) => {
    const apiKey = typeof req.body.api_key === 'string' ? req.body.api_key.trim() : '';
    if (!apiKey) {
        return res.status(400).json({ msg: 'API key Gemini không được để trống.' });
    }
    if (apiKey.length < 20 || /\s/.test(apiKey)) {
        return res.status(400).json({ msg: 'API key Gemini không hợp lệ.' });
    }

    try {
        await ensureSystemSettingsTable();
        await db.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (setting_key)
             DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
            ['gemini_api_key', apiKey]
        );
        geminiApiKey = apiKey;
        geminiApiKeySource = 'database';
        geminiSettingsLoaded = true;

        res.json({
            msg: 'Đã cập nhật Gemini API key.',
            configured: true,
            masked_key: maskApiKey(apiKey),
            source: 'database'
        });
    } catch (err) {
        console.error('Update Gemini Settings Error:', err);
        res.status(500).json({ msg: 'Không thể lưu Gemini API key.' });
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
function normalizeQuestionInput(question = {}) {
    const questionType = question.question_type === 'fill_blank' ? 'fill_blank' : 'multiple_choice';
    return {
        content: typeof question.content === 'string' ? question.content.trim() : '',
        question_type: questionType,
        option_a: questionType === 'fill_blank' ? '' : String(question.option_a || '').trim(),
        option_b: questionType === 'fill_blank' ? '' : String(question.option_b || '').trim(),
        option_c: questionType === 'fill_blank' ? '' : String(question.option_c || '').trim(),
        option_d: questionType === 'fill_blank' ? '' : String(question.option_d || '').trim(),
        correct_option: questionType === 'fill_blank' ? null : question.correct_option,
        correct_answer: questionType === 'fill_blank' ? String(question.correct_answer ?? '').trim() : null,
        explanation: typeof question.explanation === 'string' ? question.explanation.trim() : ''
    };
}

function isValidQuestionInput(question) {
    if (!question.content) return false;
    if (question.question_type === 'fill_blank') {
        return question.correct_answer.length > 0 && Number.isFinite(Number(question.correct_answer.replace(',', '.')));
    }
    return Boolean(
        question.option_a && question.option_b && question.option_c && question.option_d &&
        ['A', 'B', 'C', 'D'].includes(question.correct_option)
    );
}

async function insertQuestionRecord(client, quizId, rawQuestion) {
    const question = normalizeQuestionInput(rawQuestion);
    await client.query(
        `INSERT INTO questions
         (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, question_type, correct_answer, explanation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            quizId, question.content, question.option_a, question.option_b,
            question.option_c, question.option_d, question.correct_option,
            question.question_type, question.correct_answer, question.explanation
        ]
    );
}

app.put('/api/admin/quiz/:id', [auth, adminAuth], async (req, res) => {
    const { title, subject_id, grade, duration_minutes, questions, topic_id } = req.body;
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedQuestions = Array.isArray(questions) ? questions.map(normalizeQuestionInput) : [];

    if (!normalizedTitle || !subject_id || !grade) {
        return res.status(400).json({ msg: 'Vui lòng nhập đầy đủ tiêu đề, môn học và lớp.' });
    }
    if (!duration_minutes) {
        return res.status(400).json({ msg: 'Vui lòng nhập thời gian làm bài.' });
    }
    if (normalizedQuestions.length === 0) {
        return res.status(400).json({ msg: 'Đề thi phải có ít nhất một câu hỏi.' });
    }
    if (normalizedQuestions.some(question => !isValidQuestionInput(question))) {
        return res.status(400).json({ msg: 'Câu A-D cần đủ bốn lựa chọn; câu Điền số cần một đáp án số hợp lệ.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE quizzes SET title = $1, subject_id = $2, grade = $3, duration_minutes = $4, topic_id = $5 WHERE id = $6 RETURNING *',
            [normalizedTitle, subject_id, grade, parseInt(duration_minutes) || 15, topic_id || null, req.params.id]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ msg: 'Không tìm thấy đề thi.' });
        }

        await client.query('DELETE FROM questions WHERE quiz_id = $1', [req.params.id]);
        for (const question of normalizedQuestions) {
            await insertQuestionRecord(client, req.params.id, question);
        }

        await client.query('COMMIT');
        res.json({ msg: 'Đã cập nhật đề thi thành công.', quiz: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Update Quiz Error:', err);
        res.status(500).json({ msg: 'Không thể cập nhật đề thi.' });
    } finally {
        client.release();
    }
});

function parseQuizLocally(text) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Split the document into sections starting with "Câu" or "Question"
    const questionBlocks = normalized.split(/(?=\b(?:Câu|Question)\s*\d+)/i);
    const questions = [];
    
    for (const block of questionBlocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        
        // Match question prefix
        const matchHeader = trimmed.match(/^(?:Câu|Question)\s*\d+\s*[:\.]?\s*([\s\S]+)/i);
        if (!matchHeader) continue;
        
        const blockContent = matchHeader[1].trim();
        
        // Parse options A, B, C, D using word boundaries
        const optionARegex = /\bA\s*[\.\):]\s*([\s\S]+?)(?=(?:\b[B-D]\s*[\.\):]|$))/i;
        const optionBRegex = /\bB\s*[\.\):]\s*([\s\S]+?)(?=(?:\b[C-D]\s*[\.\):]|$))/i;
        const optionCRegex = /\bC\s*[\.\):]\s*([\s\S]+?)(?=(?:\bD\s*[\.\):]|$))/i;
        const optionDRegex = /\bD\s*[\.\):]\s*([\s\S]+?)(?=$)/i;
        
        const optA = blockContent.match(optionARegex);
        const optB = blockContent.match(optionBRegex);
        const optC = blockContent.match(optionCRegex);
        const optD = blockContent.match(optionDRegex);
        
        if (optA && optB && optC && optD) {
            // Content is anything before option A
            const contentText = blockContent.split(/\bA\s*[\.\):]/i)[0].trim();
            
            // Try to find correct answer reference in text
            let correctOption = "A";
            const answerMatch = blockContent.match(/(?:Đáp án|Chọn|Hướng dẫn giải|Giải|Đáp án đúng)\s*[:\-]?\s*([A-D])/i);
            if (answerMatch) {
                correctOption = answerMatch[1].toUpperCase();
            }
            
            // Try to find explanation reference in text
            let explanation = "";
            const explMatch = blockContent.match(/(?:Lời giải|Giải thích|HDG|Hướng dẫn giải|Giải)\s*[:\-]?\s*([\s\S]+)$/i);
            if (explMatch) {
                explanation = explMatch[1].trim();
            }
            
            questions.push({
                content: contentText,
                option_a: optA[1].trim(),
                option_b: optB[1].trim(),
                option_c: optC[1].trim(),
                option_d: optD[1].trim(),
                correct_option: correctOption,
                explanation: explanation || "Không có giải thích chi tiết."
            });
        }
    }
    return questions;
}

function isRecoverableAiError(err) {
    const status = Number(err && err.status);
    const message = [
        err && err.message,
        err && err.statusText,
        err && err.name
    ].filter(Boolean).join(' ').toLowerCase();
    return (
        status === 429 ||
        status === 503 ||
        status === 504 ||
        message.includes('429') ||
        message.includes('quota') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('service unavailable') ||
        message.includes('high demand') ||
        message.includes('temporarily unavailable') ||
        message.includes('overloaded')
    );
}

const quizQuestionsSchema = {
    type: SchemaType.ARRAY,
    items: {
        type: SchemaType.OBJECT,
        properties: {
            question_type: {
                type: SchemaType.STRING,
                format: 'enum',
                enum: ['multiple_choice', 'fill_blank']
            },
            content: { type: SchemaType.STRING },
            option_a: { type: SchemaType.STRING },
            option_b: { type: SchemaType.STRING },
            option_c: { type: SchemaType.STRING },
            option_d: { type: SchemaType.STRING },
            correct_option: {
                type: SchemaType.STRING,
                format: 'enum',
                enum: ['A', 'B', 'C', 'D']
            },
            correct_answer: { type: SchemaType.STRING },
            explanation: { type: SchemaType.STRING }
        },
        required: [
            'question_type',
            'content',
            'explanation'
        ]
    }
};

function parseAiQuizQuestions(aiText) {
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        throw new Error('AI did not return a valid JSON array.');
    }

    let json = jsonMatch[0]
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
        .replace(/,\s*([}\]])/g, '$1')
        .trim();

    const latexCommand = /(?<!\\)\\(?=(?:alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|frac|sqrt|sum|int|lim|times|cdot|div|pm|leq|geq|neq|infty|to|rightarrow|left|right|mathrm|text|overline|vec|Delta)\b)/g;
    json = json.replace(latexCommand, '\\\\');

    try {
        return JSON.parse(json);
    } catch (initialError) {
        // Preserve LaTeX commands when the model emits \alpha instead of \\alpha.
        json = json.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
        try {
            return JSON.parse(json);
        } catch {
            throw new Error(`AI returned malformed JSON: ${initialError.message}`);
        }
    }
}

// 9. Admin: Scan PDF/Word
app.post('/api/admin/scan-quiz', [auth, adminAuth, upload.single('file')], async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const { subject_id, grade, duration } = req.body;
    const originalFilename = repairUtf8Mojibake(req.file.originalname);
    let text = '';
    
    try {
        if (req.file.mimetype === 'application/pdf') {
            const data = await parsePdfBuffer(req.file.buffer);
            text = data.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await getMammothParser().extractRawText({ buffer: req.file.buffer });
            text = result.value;
        } else {
            return res.status(400).send('Only PDF and DOCX are supported.');
        }

        if (!text || text.trim().length < 10) {
            throw new Error("Tài liệu không có nội dung hoặc quá ngắn để xử lý.");
        }

        // Use Gemini to parse the extracted text into structured questions
        const gemini = await getGeminiClient();
        const model = gemini.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: quizQuestionsSchema
            }
        });
        const prompt = `Bạn là một chuyên gia soạn đề thi. Hãy trích xuất các câu hỏi trắc nghiệm từ văn bản sau đây.
        Yêu cầu:
        1. Trả về định dạng JSON là một mảng các đối tượng.
        2. Đặt "question_type": "multiple_choice". Mỗi đối tượng gồm: "content" (câu hỏi), "option_a", "option_b", "option_c", "option_d", "correct_option" (chỉ ghi chữ cái A, B, C hoặc D), và "explanation" (giải thích ngắn gọn).
        3. Tất cả ngày tháng năm trong câu hỏi, đáp án và giải thích phải giữ/chuẩn hóa theo định dạng dd/mm/yyyy (ví dụ: 05/09/2026).
        4. Văn bản: ${text}`;

        const result = await model.generateContent(prompt);
        const aiText = result.response.text();
        console.log("AI Scan Response:", aiText);

        const questions = parseAiQuizQuestions(aiText);

        const isPreview = (req.body.preview === 'true' || req.query.preview === 'true');
        if (isPreview) {
            const cleanedFilename = originalFilename.replace(/\.[^/.]+$/, "");
            return res.json({
                msg: 'Quiz parsed successfully',
                preview: true,
                title: `Đề Scan: ${cleanedFilename}`,
                subject_id: parseInt(subject_id),
                grade: parseInt(grade),
                duration: parseInt(duration || 15),
                questions: questions
            });
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const newQuiz = await client.query(
                'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *',
                [`Đề Scan: ${originalFilename}`, subject_id, grade, duration || 15]
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
        if (isRecoverableAiError(err) && req.file) {
            console.warn("AI scan temporarily unavailable. Falling back to local/mock scan quiz:", err.message);
            const cleanedFilename = originalFilename.replace(/\.[^/.]+$/, "");
            const locallyParsedQuestions = text ? parseQuizLocally(text) : [];
            const usingLocalParse = locallyParsedQuestions.length > 0;
            const questions = usingLocalParse ? locallyParsedQuestions : [
                {
                    content: `Câu hỏi mẫu trích xuất từ tài liệu quét (Dữ liệu Mock do hết hạn ngạch API $y = ax^2 + bx + c$)`,
                    option_a: "Đáp án A liên quan đến nội dung tài liệu",
                    option_b: "Đáp án B",
                    option_c: "Đáp án C",
                    option_d: "Đáp án D",
                    correct_option: "A",
                    explanation: `Giải thích chi tiết cho câu hỏi mẫu trích xuất từ tài liệu quét: ${cleanedFilename}.`
                },
                {
                    content: `Câu hỏi mẫu 2 từ tài liệu quét (Dữ liệu Mock $f'(x) = \\lim_{\\Delta x \\to 0} \\frac{f(x+\\Delta x) - f(x)}{\\Delta x}$)`,
                    option_a: "Đáp án A",
                    option_b: "Đáp án B liên quan",
                    option_c: "Đáp án C",
                    option_d: "Đáp án D",
                    correct_option: "B",
                    explanation: "Giải thích chi tiết cho câu hỏi 2."
                }
            ];

            const isPreview = (req.body.preview === 'true' || req.query.preview === 'true');
            if (isPreview) {
                return res.json({
                    msg: usingLocalParse ? 'Quiz parsed successfully (LOCAL - AI unavailable)' : 'Quiz parsed successfully (MOCK - AI unavailable)',
                    preview: true,
                    title: `Đề Scan: ${cleanedFilename} (Dữ liệu thử nghiệm - Quota Exceeded)`,
                    title: usingLocalParse ? `Đề Scan: ${cleanedFilename}` : `Đề Scan: ${cleanedFilename} (AI unavailable)`,
                    subject_id: parseInt(subject_id),
                    grade: parseInt(grade),
                    duration: parseInt(duration || 15),
                    questions: questions,
                    is_mock: !usingLocalParse,
                    is_local_parse: usingLocalParse
                });
            }

            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                const newQuiz = await client.query(
                    'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *',
                    [`Đề Scan: ${originalFilename} (Mock)`, subject_id, grade, duration || 15]
                );
                const quizId = newQuiz.rows[0].id;
                if (usingLocalParse) {
                    const localTitle = `Đề Scan: ${originalFilename}`;
                    await client.query('UPDATE quizzes SET title = $1 WHERE id = $2', [localTitle, quizId]);
                    newQuiz.rows[0].title = localTitle;
                }
                for (const q of questions) {
                    await client.query(
                        'INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                        [quizId, q.content, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation]
                    );
                }
                await client.query('COMMIT');
                return res.json({
                    msg: usingLocalParse ? 'Quiz scanned and created (LOCAL - AI unavailable)' : 'Quiz scanned and created (MOCK - AI unavailable)',
                    quiz: newQuiz.rows[0],
                    is_mock: !usingLocalParse,
                    is_local_parse: usingLocalParse
                });
            } catch (dbErr) {
                await client.query('ROLLBACK');
                console.error("DB Error in Mock Fallback:", dbErr);
                return res.status(500).json({ msg: 'Scanning Failed: ' + err.message });
            } finally {
                client.release();
            }
        }
        console.error("Scanning Error:", err);
        res.status(500).json({ msg: 'Scanning Failed: ' + err.message });
    }
});

// 11. Admin: Delete Quiz
app.delete('/api/admin/quiz/:id', [auth, adminAuth], async (req, res) => {
    const { id } = req.params;
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM results WHERE quiz_id = $1', [id]);
        const deletedQuiz = await client.query('DELETE FROM quizzes WHERE id = $1 RETURNING id', [id]);

        if (deletedQuiz.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ msg: 'Không tìm thấy đề thi.' });
        }

        await client.query('COMMIT');
        res.json({ msg: 'Đã xóa đề thi và các lượt thi liên quan.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete Quiz Error:', err.message);
        res.status(500).json({ msg: 'Không thể xóa đề thi.' });
    } finally {
        client.release();
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
    const supportsFillBlank = [1, 2, 3].includes(Number(subject_id)) || /toán|vật lý|hóa/i.test(String(subject_name || ''));
    
    try {
        const gemini = await getGeminiClient();
        const model = gemini.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: quizQuestionsSchema
            }
        });
        // Improve prompt for JSON reliability and LaTeX formatting
        const prompt = `
            Bạn là một chuyên gia biên soạn đề thi trắc nghiệm theo chuẩn của Bộ Giáo dục và Đào tạo Việt Nam.
            Hãy tạo một bộ đề thi trắc nghiệm môn ${subject_name} lớp ${grade}.
            Số lượng câu hỏi: ${count} câu.
            
            Yêu cầu nội dung:
            - Phân bổ độ khó: 40% Nhận biết, 30% Thông hiểu, 20% Vận dụng, 10% Vận dụng cao.
            ${supportsFillBlank
                ? `- Khoảng 30% câu hỏi phải là dạng điền kết quả số cuối cùng với question_type="fill_blank", correct_answer là chuỗi số; không cần option_a..option_d và correct_option.
                   - Các câu còn lại dùng question_type="multiple_choice", có đủ 4 phương án A-D và đúng duy nhất một phương án.`
                : '- Tất cả câu hỏi dùng question_type="multiple_choice", có đủ 4 phương án A-D và đúng duy nhất một phương án.'}
            - Phải có phần giải thích ngắn gọn cho đáp án đúng.
            - Tất cả ngày tháng năm trong câu hỏi, đáp án và giải thích phải có định dạng dd/mm/yyyy (ví dụ: 05/09/2026).
            - QUAN TRỌNG: Tất cả các công thức toán học, vật lý, hóa học, ký hiệu khoa học (như số pi, alpha, beta, tích phân, đạo hàm, phân số, số mũ, phương trình...) ở câu hỏi, các lựa chọn đáp án và phần giải thích BẮT BUỘC phải đặt trong cặp dấu đô-la single '$' cho công thức nội dòng (ví dụ: $y = x^2$, $H_2SO_4$, $\\alpha$) hoặc double '$$' cho khối công thức riêng biệt.
            
            Định dạng đầu ra: CHỈ TRẢ VỀ JSON MẢNG (không có văn bản giải thích ở đầu hoặc cuối). 
            BẮT BUỘC ĐÚNG ĐỊNH DẠNG JSON. Không sử dụng ký tự đặc biệt gây lỗi JSON.
            [
                {
                    "question_type": "multiple_choice hoặc fill_blank",
                    "content": "Nội dung câu hỏi...",
                    "option_a": "...",
                    "option_b": "...",
                    "option_c": "...",
                    "option_d": "...",
                    "correct_option": "A/B/C/D",
                    "correct_answer": "chỉ dùng cho fill_blank, ví dụ 12.5",
                    "explanation": "..."
                }
            ]
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        console.log("Raw AI Response length:", text.length);

        // Extract JSON array
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("AI không trả về định dạng mảng JSON hợp lệ.");
        
        let cleanedJson = jsonMatch[0]
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Remove control characters
            .trim();

        // Fix potential trailing commas before closing bracket
        cleanedJson = cleanedJson.replace(/,\s*\]/g, ']');
        
        const questions = parseAiQuizQuestions(cleanedJson).map(normalizeQuestionInput);
        if (questions.length === 0 || questions.some(question => !isValidQuestionInput(question))) {
            throw new Error('AI trả về câu hỏi thiếu đáp án hoặc sai định dạng.');
        }

        const isPreview = (req.body.preview === true || req.body.preview === 'true' || req.query.preview === 'true');
        if (isPreview) {
            return res.json({
                msg: 'Quiz generated successfully',
                preview: true,
                title: `Đề ${subject_name} Lớp ${grade} (AI biên soạn)`,
                subject_id: parseInt(subject_id),
                grade: parseInt(grade),
                duration: count == 40 ? 50 : 30,
                questions: questions
            });
        }

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
                await insertQuestionRecord(client, quizId, q);
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
        const isQuotaError = err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("Quota"));
        if (isQuotaError) {
            console.log("Quota exceeded. Falling back to Mock quiz generation...");
            const questions = [];
            const num = parseInt(count) || 10;
            for (let i = 1; i <= num; i++) {
                const useFillBlank = supportsFillBlank && i % 3 === 0;
                questions.push(useFillBlank ? {
                    question_type: 'fill_blank',
                    content: `Tính giá trị biểu thức $${i} + ${i}$ và điền kết quả cuối cùng.`,
                    correct_answer: String(i * 2),
                    explanation: `$${i} + ${i} = ${i * 2}$.`
                } : {
                    question_type: 'multiple_choice',
                    content: `Câu hỏi mẫu số ${i} môn ${subject_name} Lớp ${grade} (Tự động tạo do hết hạn ngạch API $y = f(x)$)`,
                    option_a: `Đáp án A của câu hỏi ${i}`,
                    option_b: `Đáp án B của câu hỏi ${i}`,
                    option_c: `Đáp án C của câu hỏi ${i}`,
                    option_d: `Đáp án D của câu hỏi ${i}`,
                    correct_option: ["A", "B", "C", "D"][Math.floor(Math.random() * 4)],
                    explanation: `Giải thích chi tiết cho đáp án đúng của câu hỏi số ${i} môn ${subject_name} lớp ${grade}.`
                });
            }

            const isPreview = (req.body.preview === true || req.body.preview === 'true' || req.query.preview === 'true');
            if (isPreview) {
                return res.json({
                    msg: 'Quiz generated successfully (MOCK - Quota Exceeded)',
                    preview: true,
                    title: `Đề ${subject_name} Lớp ${grade} (Dữ liệu thử nghiệm - Quota Exceeded)`,
                    subject_id: parseInt(subject_id),
                    grade: parseInt(grade),
                    duration: count == 40 ? 50 : 30,
                    questions: questions,
                    is_mock: true
                });
            }

            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                const quizTitle = `Đề ${subject_name} Lớp ${grade} (Dữ liệu thử nghiệm - Quota Exceeded)`;
                const newQuiz = await client.query(
                    'INSERT INTO quizzes (title, subject_id, grade, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *',
                    [quizTitle, subject_id, grade, count == 40 ? 50 : 30]
                );
                const quizId = newQuiz.rows[0].id;

                for (const q of questions) {
                    await insertQuestionRecord(client, quizId, q);
                }
                await client.query('COMMIT');
                return res.json({ msg: 'Quiz generated successfully (MOCK)', quiz_id: quizId, is_mock: true });
            } catch (dbErr) {
                await client.query('ROLLBACK');
                console.error("DB Error in Mock Fallback:", dbErr);
                return res.status(500).json({ msg: 'Failed to generate quiz: ' + err.message });
            } finally {
                client.release();
            }
        }
        res.status(500).json({ msg: 'Failed to generate quiz with AI: ' + err.message });
    }
});

// Admin: Manual Quiz Creation
app.post('/api/admin/quiz-manual', [auth, adminAuth], async (req, res) => {
    const { title, subject_id, grade, duration, questions, topic_id } = req.body;
    const normalizedQuestions = Array.isArray(questions) ? questions.map(normalizeQuestionInput) : [];
    if (!title || !subject_id || !grade || normalizedQuestions.length === 0) {
        return res.status(400).json({ msg: 'Vui lòng nhập đầy đủ thông tin đề và ít nhất một câu hỏi.' });
    }
    if (normalizedQuestions.some(question => !isValidQuestionInput(question))) {
        return res.status(400).json({ msg: 'Câu A-D cần đủ bốn lựa chọn; câu Điền số cần một đáp án số hợp lệ.' });
    }
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const quizRes = await client.query(
            'INSERT INTO quizzes (title, subject_id, grade, duration_minutes, topic_id, is_practice) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [title, subject_id, grade, duration, topic_id || null, false]
        );
        const quizId = quizRes.rows[0].id;
        for (const question of normalizedQuestions) {
            await insertQuestionRecord(client, quizId, question);
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
function buildSafeFallbackHint(question) {
    const content = String(question.content || '').toLowerCase();
    if (content.includes('bậc 2') || /x\s*\^\s*2|x²/.test(content)) {
        return 'Hãy đưa phương trình về dạng $ax^2 + bx + c = 0$, xác định $a, b, c$, rồi bắt đầu bằng việc tính $\Delta = b^2 - 4ac$. Dấu của $\Delta$ sẽ cho bạn biết bước tiếp theo.';
    }
    if (/vận tốc|gia tốc|quãng đường|lực|điện|dao động/.test(content)) {
        return 'Hãy liệt kê các đại lượng đề bài đã cho kèm đơn vị, xác định đại lượng cần tìm, rồi chọn công thức chỉ chứa các đại lượng đó. Chưa cần thay số ngay.';
    }
    if (/mol|phản ứng|hóa học|nồng độ|khối lượng/.test(content)) {
        return 'Hãy viết và cân bằng phương trình phản ứng trước, sau đó đổi dữ kiện về số mol. Từ tỉ lệ hệ số, bạn sẽ tìm được đại lượng cần thiết cho bước tiếp theo.';
    }
    return 'Hãy tách đề bài thành hai phần: dữ kiện đã biết và điều cần tìm. Sau đó nhớ lại công thức hoặc định nghĩa nối trực tiếp hai phần này, nhưng chưa vội tính kết quả cuối cùng.';
}

function hintRevealsFinalAnswer(hint, question) {
    const text = String(hint || '');
    if (/đáp\s*án\s*(?:là|:)?\s*[ABCD]\b/i.test(text)) return true;
    if (question.question_type === 'fill_blank' && question.correct_answer) {
        const answer = String(question.correct_answer).trim().replace(',', '.');
        const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (escaped && new RegExp(`(?:kết quả|đáp án|bằng)\\s*(?:là|:)?\\s*${escaped}(?![\\d.])`, 'i').test(text.replace(',', '.'))) {
            return true;
        }
    }
    return false;
}

app.post('/api/ai/hint', auth, async (req, res) => {
    const questionId = Number(req.body.question_id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ msg: 'Câu hỏi không hợp lệ.' });
    }

    try {
        const result = await db.query(
            `SELECT question.*, quiz.title AS quiz_title, subject.name AS subject_name
             FROM questions question
             JOIN quizzes quiz ON quiz.id = question.quiz_id
             JOIN subjects subject ON subject.id = quiz.subject_id
             WHERE question.id = $1`,
            [questionId]
        );
        if (result.rows.length === 0) return res.status(404).json({ msg: 'Không tìm thấy câu hỏi.' });

        const question = result.rows[0];
        const choices = question.question_type === 'fill_blank' ? '' : `
Các lựa chọn học sinh đang thấy:
A. ${question.option_a}
B. ${question.option_b}
C. ${question.option_c}
D. ${question.option_d}`;
        const prompt = `Bạn là gia sư Socratic cho học sinh THPT Việt Nam.
Học sinh đang làm môn ${question.subject_name}, đề "${question.quiz_title}" và chưa biết bắt đầu câu sau:
"${question.content}"
${choices}

Hãy đưa ra đúng MỘT gợi ý nhỏ bằng tiếng Việt, tối đa 3 câu:
- Chỉ gợi mở công thức, khái niệm hoặc bước đầu tiên nên làm.
- TUYỆT ĐỐI không giải hoàn chỉnh, không tính ra kết quả cuối cùng.
- Không nói đáp án A/B/C/D và không tiết lộ giá trị đáp án điền số.
- Nếu là phương trình bậc hai, hãy gợi ý xác định a, b, c và cách tính Delta, không nói nghiệm.
- Giọng điệu thân thiện, khích lệ. Không mở đầu dài dòng.`;

        try {
            const gemini = await getGeminiClient();
            const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const aiResult = await model.generateContent(prompt);
            const hint = aiResult.response.text().trim();
            if (!hint || hintRevealsFinalAnswer(hint, question)) {
                return res.json({ hint: buildSafeFallbackHint(question), is_fallback: true });
            }
            return res.json({ hint, is_fallback: false });
        } catch (aiError) {
            console.warn('AI Hint fallback:', aiError.message);
            return res.json({ hint: buildSafeFallbackHint(question), is_fallback: true });
        }
    } catch (err) {
        console.error('AI Hint Error:', err.message);
        res.status(500).json({ msg: 'Không thể tạo gợi ý lúc này.' });
    }
});

function isStoredQuestionAnswerCorrect(question, answer) {
    if (question.question_type !== 'fill_blank') {
        return answer === question.correct_option;
    }
    const expected = Number(String(question.correct_answer ?? '').trim().replace(',', '.'));
    const actual = Number(String(answer ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
    const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-4);
    return Math.abs(actual - expected) <= tolerance;
}

app.post('/api/ai/analyze-results', auth, async (req, res) => {
    const { quiz_id, score, correct_count, total_count, userAnswers } = req.body;
    console.log("AI Analysis Request for quiz_id:", quiz_id);
    try {
        // Get quiz info
        const quizRes = await db.query(
            'SELECT q.title, s.name as subject_name FROM quizzes q JOIN subjects s ON q.subject_id = s.id WHERE q.id = $1',
            [quiz_id]
        );
        if (quizRes.rows.length === 0) return res.status(404).json({ msg: 'Quiz not found' });
        
        const quiz = quizRes.rows[0];
        const questionsRes = await db.query('SELECT * FROM questions WHERE quiz_id = $1 ORDER BY id ASC', [quiz_id]);
        const questions = questionsRes.rows;

        // Identify wrong answers
        let weakPoints = [];
        questions.forEach((q, index) => {
            if (!isStoredQuestionAnswerCorrect(q, userAnswers[index])) {
                weakPoints.push({
                    content: q.content,
                    correct_option: q.question_type === 'fill_blank' ? q.correct_answer : q.correct_option,
                    explanation: q.explanation
                });
            }
        });

        const gemini = await getGeminiClient();
        const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
        Bạn là một cố vấn học tập AI thông minh. Hãy phân tích kết quả bài thi sau và đưa ra lộ trình học tập.
        
        THÔNG TIN BÀI THI:
        - Môn học: ${quiz.subject_name}
        - Tên đề: ${quiz.title}
        - Điểm số: ${Number(score).toFixed(1)}/10
        - Số câu đúng: ${correct_count}/${total_count}
        
        CÁC CÂU HỎI SAI VÀ KIẾN THỨC CẦN LƯU Ý:
        ${weakPoints.length > 0 ? weakPoints.map((wp, i) => `${i+1}. ${wp.content} (Đáp án đúng: ${wp.correct_option}). Giải thích: ${wp.explanation || 'N/A'}`).join('\n') : 'Không có câu nào sai.'}
        
        YÊU CẦU:
        1. Nhận xét tổng quan về trình độ hiện tại của học sinh dựa trên điểm số (từ 0-10).
        2. Chỉ ra các mảng kiến thức bị hổng dựa trên các câu sai.
        3. Đề xuất một LỘ TRÌNH HỌC TẬP CÁ NHÂN HÓA trong 4 tuần để cải thiện (chia rõ từng tuần cần học gì, làm gì).
        4. Đưa ra 3 lời khuyên cụ thể để học tốt môn ${quiz.subject_name} hơn.
        
        TRÌNH BÀY & ĐỊNH DẠNG:
        - Sử dụng ngôn ngữ tiếng Việt thân thiện, khích lệ.
        - Trình bày dưới dạng Markdown đẹp mắt, có tiêu đề, danh sách, in đậm.
        - Không cần phần giới thiệu rườm rà, đi thẳng vào phân tích.
        - QUAN TRỌNG: Tất cả các công thức toán học, ký hiệu khoa học (như số pi, alpha, beta, tích phân, đạo hàm, phân số, số mũ, phương trình...) BẮT BUỘC phải đặt trong cặp dấu đô-la single '$' cho công thức nội dòng (ví dụ: $y = x^2$) hoặc double '$$' cho khối công thức riêng biệt (ví dụ: $$\\int x \\, dx$$).
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisText = response.text();

        if (!analysisText) {
            throw new Error("AI returned empty response");
        }

        res.json({ analysis: analysisText });
    } catch (err) {
        console.error("AI Analysis Detailed Error:", err);
        const isQuotaError = err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("Quota"));
        if (isQuotaError) {
             console.log("Quota exceeded. Falling back to Mock analysis...");
             return res.json({ analysis: "### Phân tích kết quả học tập (Dữ liệu thử nghiệm - Hết hạn ngạch API)\n\n* **Nhận xét tổng quan**: Bạn đã hoàn thành bài thi với sự nỗ lực rất đáng khen ngợi. Mặc dù còn một số câu trả lời chưa chính xác, đây chính là cơ hội tốt để ôn tập lại kiến thức.\n* **Kiến thức cần lưu ý**: Hãy tập trung ôn tập kỹ lý thuyết của các câu hỏi đã làm sai trong bài kiểm tra.\n* **Lộ trình học tập cá nhân hóa**: \n  * **Tuần 1**: Hệ thống lại toàn bộ lý thuyết liên quan đến các dạng câu hỏi bị sai.\n  * **Tuần 2**: Làm lại các bài trắc nghiệm tương tự.\n  * **Tuần 3 & 4**: Nâng cao kỹ năng làm bài thi thông qua giải đề mẫu.\n* **3 Lời khuyên học tốt**: \n  1. Đọc kỹ đề bài trước khi chọn đáp án.\n  2. Ghi chú các công thức quan trọng vào sổ tay học tập.\n  3. Đều đặn ôn tập mỗi ngày để ghi nhớ lâu hơn." });
        }
        res.status(500).json({ 
            msg: 'AI Analysis Failed', 
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// AI Chat Tutor
app.post('/api/chat', auth, async (req, res) => {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ msg: 'Tin nhắn không được để trống.' });

    try {
        const systemText = `Bạn là một Gia sư AI chuyên nghiệp, tận tâm và giàu kinh nghiệm tại Việt Nam.
Nhiệm vụ của bạn là hỗ trợ học sinh học tập và giải đáp thắc mắc về mọi môn học.
Hãy tuân thủ các quy tắc sau:
1. Trả lời bằng tiếng Việt, thân thiện, ngắn gọn, súc tích, đi thẳng vào câu hỏi, tránh giải thích dài dòng hoặc lan man.
2. Trình bày lời giải chi tiết, từng bước một nếu là bài toán/bài tập, nhưng giữ các bước giải rõ ràng, ngắn gọn và dễ hiểu nhất.
3. Sử dụng định dạng Markdown (tiêu đề, danh sách, in đậm, khối mã) để câu trả lời đẹp mắt, dễ theo dõi.
4. QUAN TRỌNG: Tất cả các công thức toán học, ký hiệu khoa học (như số pi, alpha, beta, tích phân, đạo hàm, phân số, số mũ, phương trình...) BẮT BUỘC phải đặt trong cặp dấu đô-la single '$' cho công thức nội dòng (ví dụ: $y = x^3$) hoặc double '$$' cho khối công thức riêng biệt (ví dụ: $$\\int x^2 \\, dx$$). Không được ghi ký hiệu thô không định dạng.
5. Tránh trả lời các câu hỏi không liên quan đến học tập hoặc các chủ đề bạo lực, nhạy cảm.
6. Nếu câu hỏi không rõ ràng, hãy lịch sự hỏi lại hoặc đưa ra các trường hợp giả định để giải thích.
7. Xưng hô với người dùng là "Bạn" và gọi bản thân là "Mình" (xưng hô Bạn - Mình). Tuyệt đối không xưng hô Thầy/Cô - Em hoặc các đại từ xưng hô khác.`;

        const gemini = await getGeminiClient();
        const model = gemini.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: { parts: [{ text: systemText }] }
        });

        const chat = model.startChat({
            history: history || []
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const text = response.text();

        res.json({ reply: text });
    } catch (err) {
        console.error("AI Chat Error:", err);
        const isQuotaError = err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("Quota"));
        if (isQuotaError) {
             console.log("Quota exceeded. Falling back to Mock chat reply...");
             return res.json({ reply: "Xin chào! Hiện tại hệ thống AI Gia sư của mình đang tạm thời hết hạn ngạch truy cập (Quota 429). Bạn có thể thử lại sau ít phút hoặc liên hệ với quản trị viên nhé! Rất xin lỗi vì sự bất tiện này." });
        }
        res.status(500).json({ msg: 'Gặp lỗi khi kết nối với AI Gia sư.', error: err.message });
    }
});

function parseRoadmapHistory(rawRoadmapData) {
    if (!rawRoadmapData) return [];

    if (Array.isArray(rawRoadmapData)) {
        return rawRoadmapData.filter(item => item && typeof item.content === 'string');
    }

    if (typeof rawRoadmapData === 'string') {
        try {
            const parsed = JSON.parse(rawRoadmapData);
            if (Array.isArray(parsed)) {
                return parsed.filter(item => item && typeof item.content === 'string');
            }
        } catch (err) {
            // Legacy roadmap_data values contain the Markdown directly.
        }

        return [{ content: rawRoadmapData, created_at: null }];
    }

    return [];
}

function buildRoadmapHistory(rawRoadmapData, roadmapText) {
    const history = parseRoadmapHistory(rawRoadmapData);
    return JSON.stringify([
        { content: roadmapText, created_at: new Date().toISOString() },
        ...history
    ].slice(0, 5));
}

app.get('/api/roadmap/history', auth, async (req, res) => {
    try {
        const result = await db.query('SELECT roadmap_data FROM users WHERE id = $1', [req.user.id]);
        const history = parseRoadmapHistory(result.rows[0]?.roadmap_data).slice(0, 5);
        res.json({ history });
    } catch (err) {
        console.error('Roadmap History Error:', err);
        res.status(500).json({ msg: 'Không thể tải lịch sử lộ trình.' });
    }
});

// 15. Generate Personalized Study Roadmap
app.post('/api/roadmap/generate', auth, async (req, res) => {
    let currentRoadmapData = null;

    try {
        // 1. Get User Survey and Results
        const userRes = await db.query('SELECT survey_data, roadmap_data FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];
        currentRoadmapData = user.roadmap_data;
        const survey = typeof user.survey_data === 'string' ? JSON.parse(user.survey_data) : (user.survey_data || {});

        const resultsRes = await db.query(`
            SELECT r.score, r.correct_answers_count, r.total_questions, q.title, s.name as subject_name 
            FROM results r 
            JOIN quizzes q ON r.quiz_id = q.id 
            JOIN subjects s ON q.subject_id = s.id 
            WHERE r.user_id = $1 
            ORDER BY r.completed_at DESC 
            LIMIT 5
        `, [req.user.id]);
        const results = resultsRes.rows;

        // 2. Prepare AI Prompt
        const gemini = await getGeminiClient();
        const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
            Bạn là một chuyên gia giáo dục cao cấp. Hãy xây dựng một LỘ TRÌNH HỌC TẬP CÁ NHÂN HÓA trong 4 tuần cho học sinh dựa trên thông tin sau:
            
            HỒ SƠ HỌC SINH:
            - Lớp: ${survey.grade || 'Không rõ'}
            - Ban học: ${survey.stream || 'Không rõ'}
            - Mục tiêu: ${survey.goal || 'Nâng cao kiến thức'}
            - Thế mạnh: ${Array.isArray(survey.strengths) ? survey.strengths.join(', ') : (survey.strengths || 'Chưa xác định')}
            - Cần cải thiện: ${Array.isArray(survey.weaknesses) ? survey.weaknesses.join(', ') : (survey.weaknesses || 'Chưa xác định')}
            
            KẾT QUẢ CÁC BÀI KIỂM TRA GẦN ĐÂY:
            ${results.length > 0 ? results.map(r => `- ${r.title} (${r.subject_name}): ${r.score}/10`).join('\n') : 'Chưa có dữ liệu kiểm tra.'}
            
            YÊU CẦU LỘ TRÌNH:
            1. Chia rõ lộ trình thành 4 tuần (Tuần 1 -> Tuần 4).
            2. Mỗi tuần ghi rõ: Trọng tâm kiến thức, Các môn cần ưu tiên, và Bài tập/Hành động cụ thể.
            3. Lời khuyên dựa trên "Thế mạnh" và "Điểm yếu" đã khai báo.
            4. Phong cách trình bày: Chuyên nghiệp, khích lệ, sử dụng Markdown (Tiêu đề, danh sách, in đậm).
            5. Ngôn ngữ: Tiếng Việt.
            6. QUAN TRỌNG: Tất cả các công thức toán học, ký hiệu khoa học (như số pi, alpha, beta, tích phân, đạo hàm, phân số, số mũ, phương trình...) BẮT BUỘC phải đặt trong cặp dấu đô-la single '$' cho công thức nội dòng (ví dụ: $y = x^2$) hoặc double '$$' cho khối công thức riêng biệt (ví dụ: $$\\int x \\, dx$$).
            
            Không cần lời chào hỏi dài dòng, đi thẳng vào nội dung lộ trình.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const roadmapText = response.text();

        // 3. Save to DB
        const roadmapHistory = buildRoadmapHistory(currentRoadmapData, roadmapText);
        await db.query('UPDATE users SET roadmap_data = $1 WHERE id = $2', [roadmapHistory, req.user.id]);

        res.json({ msg: 'Roadmap generated', roadmap: roadmapText, history: JSON.parse(roadmapHistory) });
    } catch (err) {
        console.error("Roadmap Gen Error:", err);
        const isQuotaError = err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("Quota"));
        if (isQuotaError) {
             console.log("Quota exceeded. Falling back to Mock roadmap...");
             const roadmapText = "### Lộ trình học tập cá nhân hóa 4 tuần (Dữ liệu thử nghiệm - Hết hạn ngạch API)\n\n* **Tuần 1: Ôn tập cốt lõi**\n  * Trọng tâm: Tập trung nắm vững lại các khái niệm cơ bản dựa trên kết quả khảo sát của bạn.\n  * Bài tập: Hoàn thành 2 bài kiểm tra trắc nghiệm cơ bản.\n* **Tuần 2: Nâng cao kỹ năng**\n  * Trọng tâm: Ôn luyện chuyên sâu các phần kiến thức còn yếu.\n  * Bài tập: Giải các bài tập tự luyện và ghi chú lại các lỗi thường gặp.\n* **Tuần 3: Luyện đề tổng hợp**\n  * Trọng tâm: Bắt đầu làm quen với các đề thi có thời gian làm bài thực tế.\n* **Tuần 4: Đánh giá & Điều chỉnh**\n  * Trọng tâm: Kiểm tra lại các lỗ hổng kiến thức cuối cùng để sẵn sàng cho bài thi chính thức.";
             try {
                 const roadmapHistory = buildRoadmapHistory(currentRoadmapData, roadmapText);
                 await db.query('UPDATE users SET roadmap_data = $1 WHERE id = $2', [roadmapHistory, req.user.id]);
                 return res.json({
                     msg: 'Roadmap generated (MOCK)',
                     roadmap: roadmapText,
                     history: JSON.parse(roadmapHistory),
                     is_mock: true
                 });
             } catch (dbErr) {
                 console.error("DB Error in Mock Roadmap Fallback:", dbErr);
                 return res.status(500).json({ msg: 'Failed to save mock roadmap', error: dbErr.message });
             }
        }
        res.status(500).json({ msg: 'Failed to generate roadmap', error: err.message });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, (err) => {
        if (err) {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use. Stop the existing process or set a different PORT in .env.`);
            } else {
                console.error('Failed to start server:', err);
            }
            process.exitCode = 1;
            return;
        }

        console.log(`Server is running on port ${PORT}`);
    });
}
