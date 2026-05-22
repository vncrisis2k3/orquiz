const API_URL = 'http://localhost:5000/api';
let currentQuiz = null;
let currentSubjectId = null;
let currentGrade = null;
let questions = [];
let currentQuestionIndex = 0;
let userAnswers = {};
let timeLeft = 0;
let timerInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!localStorage.getItem('token')) {
        window.location.href = 'auth.html';
        return;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const subjectId = urlParams.get('subject');
    const grade = urlParams.get('grade');
    currentSubjectId = subjectId;
    currentGrade = grade;
    const quizId = urlParams.get('id');

    if (quizId) {
        loadQuiz(quizId);
    } else if (subjectId) {
        // Find a random quiz for this subject and grade
        loadRandomQuiz(subjectId, null, grade);
    }

    document.getElementById('next-btn').addEventListener('click', nextQuestion);
    document.getElementById('prev-btn').addEventListener('click', prevQuestion);
});

async function loadQuiz(id) {
    try {
        const response = await fetch(`${API_URL}/quiz/${id}`);
        currentQuiz = await response.json();
        questions = currentQuiz.questions;
        
        document.getElementById('quiz-title').textContent = currentQuiz.title;
        timeLeft = currentQuiz.duration_minutes * 60;
        
        startTimer();
        renderQuestion();
    } catch (error) {
        console.error('Error loading quiz:', error);
    }
}

function renderQuestion() {
    const container = document.getElementById('quiz-container');
    const question = questions[currentQuestionIndex];
    
    // Update progress bar
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;

    container.innerHTML = `
        <div class="question-card">
            <span class="question-meta">Câu hỏi ${currentQuestionIndex + 1} / ${questions.length}</span>
            <p class="question-text">${question.content}</p>
            <div class="options-grid">
                ${['A', 'B', 'C', 'D'].map(opt => `
                    <button class="option-btn ${userAnswers[currentQuestionIndex] === opt ? 'selected' : ''}" 
                            onclick="selectOption('${opt}')">
                        <span class="option-prefix">${opt}</span>
                        ${question[`option_${opt.toLowerCase()}`]}
                    </button>
                `).join('')}
            </div>
        </div>
    `;

    // Update buttons
    document.getElementById('prev-btn').disabled = currentQuestionIndex === 0;
    document.getElementById('next-btn').textContent = 
        currentQuestionIndex === questions.length - 1 ? 'Nộp bài' : 'Câu sau';
}

function selectOption(option) {
    userAnswers[currentQuestionIndex] = option;
    renderQuestion();
}

function nextQuestion() {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
    } else {
        submitQuiz();
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion();
    }
}

function startTimer() {
    timerInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        document.getElementById('timer').textContent = 
            `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            submitQuiz();
        }
    }, 1000);
}

async function submitQuiz() {
    clearInterval(timerInterval);
    
    let correctCount = 0;
    questions.forEach((q, index) => {
        if (userAnswers[index] === q.correct_option) {
            correctCount++;
        }
    });

    const score = (correctCount / questions.length) * 10;
    
    // Show results in modal
    document.getElementById('final-score').textContent = score.toFixed(1);
    document.getElementById('result-msg').textContent = `Bạn đã trả lời đúng ${correctCount}/${questions.length} câu hỏi.`;
    document.getElementById('result-modal').style.display = 'flex';

    // Submit to API
    const user = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('token');
    
    try {
        await fetch(`${API_URL}/results`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({
                user_id: user.id,
                quiz_id: currentQuiz.id,
                score: score,
                correct_count: correctCount,
                total_count: questions.length,
                time_spent: (currentQuiz.duration_minutes * 60) - timeLeft
            })
        });
    } catch (error) {
        console.error('Error submitting results:', error);
    }
}
async function loadRandomQuiz(subjectId, excludeId = null, grade = null) {
    try {
        const res = await fetch(`${API_URL}/quizzes/${subjectId}`);
        let quizzes = await res.json();
        
        // Filter by grade if provided
        if (grade) {
            quizzes = quizzes.filter(q => q.grade == grade);
        }

        if (excludeId) {
            quizzes = quizzes.filter(q => q.id != excludeId);
        }

        if (quizzes.length > 0) {
            const randomIndex = Math.floor(Math.random() * quizzes.length);
            loadQuiz(quizzes[randomIndex].id);
        } else {
            document.getElementById('quiz-title').textContent = 'Chưa có đề thi';
            document.getElementById('quiz-container').innerHTML = `
                <div class="loading" style="text-align: center; padding: 50px;">
                    <h3>Hệ thống đang cập nhật đề thi Lớp ${grade || ''}.</h3>
                    <p>Vui lòng chọn lớp khác hoặc quay lại sau!</p>
                    <a href="index.html" class="btn btn-primary" style="margin-top: 20px;">Quay lại Trang chủ</a>
                </div>`;
        }
    } catch (err) {
        console.error('Error fetching subject quizzes:', err);
    }
}

async function loadAnotherQuiz() {
    if (currentSubjectId) {
        // Reset state
        document.getElementById('result-modal').style.display = 'none';
        document.getElementById('review-container').style.display = 'none';
        document.getElementById('review-btn').style.display = 'block';
        currentQuestionIndex = 0;
        userAnswers = {};
        
        // Load a new random quiz, excluding the current one, keeping same grade
        await loadRandomQuiz(currentSubjectId, currentQuiz ? currentQuiz.id : null, currentGrade);
    } else {
        window.location.href = 'index.html';
    }
}

function showReview() {
    const list = document.getElementById('wrong-answers-list');
    list.innerHTML = '';
    let hasWrong = false;

    questions.forEach((q, index) => {
        if (userAnswers[index] !== q.correct_option) {
            hasWrong = true;
            const item = document.createElement('div');
            item.className = 'wrong-answer-item';
            item.innerHTML = `
                <b>Câu ${index + 1}: ${q.content}</b>
                <p>Bạn chọn: <span class="your-ans">${userAnswers[index] || 'Chưa trả lời'}</span></p>
                <p>Đáp án đúng: <span class="correct-ans">${q.correct_option}</span></p>
                ${q.explanation ? `<p style="font-size: 0.9rem; color: #64748b; margin-top: 8px;"><i>💡 Giải thích: ${q.explanation}</i></p>` : ''}
            `;
            list.appendChild(item);
        }
    });

    if (!hasWrong) {
        list.innerHTML = '<p style="color: #10b981; font-weight: bold;">Tuyệt vời! Bạn không sai câu nào.</p>';
    }

    document.getElementById('review-container').style.display = 'block';
    document.getElementById('review-btn').style.display = 'none';
}

async function analyzeAI() {
    const aiBtn = document.getElementById('ai-btn');
    const container = document.getElementById('ai-report-container');
    const content = document.getElementById('ai-report-content');
    
    // Calculate final score if not already available
    let correctCount = 0;
    questions.forEach((q, index) => {
        if (userAnswers[index] === q.correct_option) {
            correctCount++;
        }
    });
    const score = (correctCount / questions.length) * 10;

    aiBtn.disabled = true;
    aiBtn.innerHTML = '<span class="ai-loader" style="width: 15px; height: 15px; border-width: 2px;"></span> Đang phân tích...';
    
    container.style.display = 'block';
    content.innerHTML = `
        <div class="ai-loading">
            <div class="ai-loader"></div>
            <p>AI đang phân tích kết quả và xây dựng lộ trình học tập cho bạn...</p>
        </div>
    `;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/ai/analyze-results`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': token
            },
            body: JSON.stringify({
                quiz_id: currentQuiz.id,
                score: score,
                correct_count: correctCount,
                total_count: questions.length,
                userAnswers: userAnswers
            })
        });

        const data = await response.json();
        console.log('AI Analysis Response Data:', data);

        if (response.status === 401 || data.msg === "Token is not valid") {
            content.innerHTML = '<p style="color: var(--danger);">Phiên đăng nhập đã hết hạn. Đang chuyển hướng đến trang đăng nhập...</p>';
            setTimeout(() => {
                localStorage.removeItem('token');
                window.location.href = 'auth.html';
            }, 2000);
            return;
        }

        if (data.analysis) {
            content.innerHTML = renderMarkdown(data.analysis);
        } else if (data.error || data.msg) {
            content.innerHTML = `<p style="color: var(--danger);">Lỗi hệ thống: ${data.error || data.msg}.</p>`;
        } else {
            content.innerHTML = '<p style="color: var(--danger);">Máy chủ AI trả về kết quả không xác định. Vui lòng thử lại.</p>';
        }
    } catch (error) {
        console.error('Fetch error in analyzeAI:', error);
        content.innerHTML = '<p style="color: var(--danger);">Không thể kết nối với máy chủ. Kiểm tra kết nối mạng hoặc trạng thái Server.</p>';
    } finally {
        aiBtn.disabled = false;
        aiBtn.innerHTML = '<span class="ai-sparkle">✨</span> Phân tích lại';
    }
}

// Simple Markdown to HTML helper
function renderMarkdown(text) {
    if (!text) return '';
    
    let html = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^\* (.*$)/gim, '<li>$1</li>')
        .replace(/^- (.*$)/gim, '<li>$1</li>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/\n/gim, '<br>');

    // Wrap list items
    html = html.replace(/<li>(.*?)<\/li>/gs, (match) => `<ul>${match}</ul>`);
    // Fix multiple <ul>
    html = html.replace(/<\/ul><ul>/gim, '');
    
    return html;
}
