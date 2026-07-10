const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? 'http://localhost:5000/api' : '/api';
let currentQuiz = null;
let currentSubjectId = null;
let currentGrade = null;
let questions = [];
let currentQuestionIndex = 0;
let userAnswers = {};
let timeLeft = 0;
let timerInterval = null;
let currentMode = 'exam'; // 'exam' or 'practice'
let currentSource = null;
let quizSubmitted = false;
let answeredQuestions = new Set();
let skillCorrectCount = 0;
let instantFeedbackTimer = null;
const questionHints = {};
const hintRequestsInFlight = new Set();
let pageExitWarnings = 0;
let lastExitWarningAt = 0;
const MAX_PAGE_EXIT_WARNINGS = 3;

function isExamMode() {
    return currentMode === 'exam';
}

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
    currentMode = urlParams.get('mode') || 'exam';
    currentSource = urlParams.get('source');
    const quizId = urlParams.get('id');

    if (quizId) {
        if (currentMode === 'practice' && currentSource === 'skill-tree') {
            const canOpen = await ensureSkillTreeAccess(quizId);
            if (!canOpen) return;
            const anotherButton = document.getElementById('another-quiz-btn');
            if (anotherButton) anotherButton.textContent = 'Về bản đồ học tập';
        }
        if (currentMode === 'exam' && currentSource === 'exams') {
            const anotherButton = document.getElementById('another-quiz-btn');
            if (anotherButton) anotherButton.textContent = 'Quay lại danh sách môn';
        }
        await loadQuiz(quizId);
    } else if (subjectId) {
        // Find a random quiz for this subject and grade
        loadRandomQuiz(subjectId, null, grade);
    }

    document.getElementById('next-btn').addEventListener('click', nextQuestion);
    document.getElementById('prev-btn').addEventListener('click', prevQuestion);
    if (currentMode === 'exam') {
        initAntiExitGuard();
    }
});

async function ensureSkillTreeAccess(quizId) {
    try {
        const response = await fetch(`${API_URL}/skill-tree/access/${quizId}`, {
            headers: { 'x-auth-token': localStorage.getItem('token') }
        });
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'auth.html';
            return false;
        }
        if (!response.ok) throw new Error(data.msg || 'Không thể kiểm tra trạm học tập.');

        currentSubjectId = currentSubjectId || data.subject_id;
        currentGrade = currentGrade || data.grade;
        if (!data.unlocked) {
            alert(data.msg || 'Trạm học tập này chưa được mở khóa.');
            window.location.href = `skill-tree.html?subject=${data.subject_id}&grade=${data.grade}`;
            return false;
        }
        return true;
    } catch (error) {
        console.error('Skill tree access error:', error);
        alert(error.message);
        window.location.href = 'skill-tree.html';
        return false;
    }
}

function initAntiExitGuard() {
    window.addEventListener('beforeunload', (event) => {
        if (!isQuizInProgress()) return;
        registerPageExitAttempt('Bạn đang cố rời khỏi trang làm bài', true);
        event.preventDefault();
        event.returnValue = 'Bạn đang làm bài. Rời khỏi trang có thể bị tính là vi phạm.';
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            registerPageExitAttempt('Bạn đã rời khỏi tab làm bài');
        }
    });

    window.addEventListener('blur', () => {
        registerPageExitAttempt('Bạn đã chuyển khỏi cửa sổ làm bài');
    });
}

function isQuizInProgress() {
    return currentMode === 'exam' && Boolean(currentQuiz && questions.length > 0 && !quizSubmitted);
}

function registerPageExitAttempt(reason, fromBeforeUnload = false) {
    if (!isQuizInProgress()) return;

    const now = Date.now();
    if (now - lastExitWarningAt < 1200) return;
    lastExitWarningAt = now;
    pageExitWarnings++;

    if (pageExitWarnings > MAX_PAGE_EXIT_WARNINGS) {
        quizSubmitted = true;
        clearInterval(timerInterval);
        sessionStorage.setItem('quiz_exit_locked', 'true');
        if (!fromBeforeUnload) {
            alert('Bạn đã thoát khỏi trang làm bài quá 3 lần. Hệ thống sẽ tự động đưa bạn về trang chủ.');
        }
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 0);
        return;
    }

    if (fromBeforeUnload) return;

    const remaining = MAX_PAGE_EXIT_WARNINGS - pageExitWarnings;
    alert(`${reason}. Cảnh báo ${pageExitWarnings}/${MAX_PAGE_EXIT_WARNINGS}. Nếu tiếp tục thoát quá 3 lần, hệ thống sẽ tự động đưa bạn về trang chủ. Bạn còn ${remaining} lần.`);
}

async function loadQuiz(id) {
    try {
        const response = await fetch(`${API_URL}/quiz/${id}`);
        if (!response.ok) throw new Error('Không thể tải bài học.');
        currentQuiz = await response.json();
        currentSubjectId = currentSubjectId || currentQuiz.subject_id;
        currentGrade = currentGrade || currentQuiz.grade;
        questions = Array.isArray(currentQuiz.questions) ? currentQuiz.questions : [];
        answeredQuestions = new Set();
        skillCorrectCount = 0;

        if (isBiteSizedLesson()) {
            document.body.classList.add('bite-sized-lesson');
            questions = questions.slice(0, 15);
            const progressLabel = document.getElementById('skill-progress-label');
            if (progressLabel) {
                progressLabel.style.display = 'block';
                progressLabel.textContent = `Đã làm đúng 0/${questions.length} câu`;
            }
            updateBiteSizedProgress();
        }

        if (questions.length === 0) throw new Error('Bài học chưa có câu hỏi.');
        
        document.getElementById('quiz-title').textContent = isBiteSizedLesson()
            ? `${currentQuiz.title} · ${questions.length} câu`
            : currentQuiz.title;
        
        const timerEl = document.getElementById('timer');
        if (currentMode === 'practice') {
            timeLeft = 0;
            if (timerEl) {
                timerEl.style.display = 'none';
            }
        } else {
            timeLeft = currentQuiz.duration_minutes * 60;
            if (timerEl) {
                timerEl.style.display = '';
                timerEl.style.background = "rgba(255, 122, 0, 0.1)";
                timerEl.style.color = "var(--primary)";
            }
            startTimer();
        }
        
        renderQuestion();
    } catch (error) {
        console.error('Error loading quiz:', error);
    }
}

function isBiteSizedLesson() {
    return currentMode === 'practice' && currentSource === 'skill-tree';
}

function renderQuestion() {
    const container = document.getElementById('quiz-container');
    const question = questions[currentQuestionIndex];
    const answered = answeredQuestions.has(currentQuestionIndex);
    
    // Update progress bar
    if (isBiteSizedLesson()) {
        updateBiteSizedProgress();
    } else {
        const progress = ((currentQuestionIndex + 1) / questions.length) * 100;
        document.getElementById('progress-bar').style.width = `${progress}%`;
    }

    container.innerHTML = `
        <div class="question-card">
            <span class="question-meta">${isBiteSizedLesson() ? 'Miếng kiến thức' : 'Câu hỏi'} ${currentQuestionIndex + 1} / ${questions.length}</span>
            <p class="question-text">${autoWrapMath(question.content)}</p>
            ${question.question_type === 'fill_blank' ? renderFillBlankInput(question, answered) : `<div class="options-grid">
                ${['A', 'B', 'C', 'D'].map(opt => `
                    <button class="option-btn ${getOptionStateClass(opt, question, answered)}"
                            onclick="selectOption('${opt}')" ${answered ? 'disabled' : ''}>
                        <span class="option-prefix">${opt}</span>
                        ${autoWrapMath(question[`option_${opt.toLowerCase()}`])}
                    </button>
                `).join('')}
            </div>`}
            ${renderQuestionHint(question)}
        </div>
    `;

    // Render KaTeX for math elements
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(container, {
            delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false},
                {left: "\\(", right: "\\)", display: false},
                {left: "\\[", right: "\\]", display: true}
            ],
            throwOnError: false
        });
    }

    // Update buttons
    document.getElementById('prev-btn').disabled = currentQuestionIndex === 0;
    document.getElementById('next-btn').textContent = 
        currentQuestionIndex === questions.length - 1 ? 'Nộp bài' : 'Câu sau';
    document.getElementById('next-btn').disabled = !answered;
}

function renderQuestionHint(question) {
    const cachedHint = questionHints[question.id];
    const loading = hintRequestsInFlight.has(question.id);
    return `
        <div class="question-hint-tools">
            <button type="button" class="ask-ai-hint-btn" id="ask-ai-hint-btn" onclick="requestAiHint()" ${loading ? 'disabled' : ''}>
                <span>${loading ? '⏳' : '✨'}</span> ${loading ? 'AI đang suy nghĩ...' : (cachedHint ? 'Xem lại gợi ý' : 'Hỏi AI')}
            </button>
            <div class="ai-hint-card ${cachedHint ? 'show' : ''}" id="ai-hint-card">
                <div class="ai-hint-heading"><span>🤖</span><strong>Gợi ý từ EduBot</strong></div>
                <div class="ai-hint-content" id="ai-hint-content">${cachedHint ? autoWrapMath(escapeAttribute(cachedHint)) : ''}</div>
                <div class="ai-hint-warning">Gợi ý chỉ mở hướng suy nghĩ, không đưa đáp án cuối cùng.</div>
            </div>
        </div>`;
}

async function requestAiHint() {
    const question = questions[currentQuestionIndex];
    if (!question || hintRequestsInFlight.has(question.id)) return;

    const card = document.getElementById('ai-hint-card');
    if (questionHints[question.id]) {
        card?.classList.toggle('show');
        return;
    }

    const button = document.getElementById('ask-ai-hint-btn');
    const content = document.getElementById('ai-hint-content');
    hintRequestsInFlight.add(question.id);
    if (button) {
        button.disabled = true;
        button.innerHTML = '<span>⏳</span> AI đang suy nghĩ...';
    }
    if (card) card.classList.add('show', 'loading');
    if (content) content.textContent = 'Mình đang tìm một gợi ý vừa đủ cho bạn...';

    try {
        const response = await fetch(`${API_URL}/ai/hint`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': localStorage.getItem('token')
            },
            body: JSON.stringify({ question_id: question.id })
        });
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'auth.html';
            return;
        }
        if (!response.ok || !data.hint) throw new Error(data.msg || 'AI chưa thể tạo gợi ý.');

        questionHints[question.id] = data.hint;
        const activeCard = questions[currentQuestionIndex]?.id === question.id ? document.getElementById('ai-hint-card') : card;
        const activeContent = questions[currentQuestionIndex]?.id === question.id ? document.getElementById('ai-hint-content') : content;
        if (activeContent) activeContent.innerHTML = autoWrapMath(escapeAttribute(data.hint));
        if (activeCard) activeCard.classList.add('show');
        if (activeCard) activeCard.classList.remove('loading');
        if (typeof renderMathInElement === 'function' && activeCard) {
            renderMathInElement(activeCard, {
                delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}],
                throwOnError: false
            });
        }
    } catch (error) {
        const activeCard = questions[currentQuestionIndex]?.id === question.id ? document.getElementById('ai-hint-card') : card;
        const activeContent = questions[currentQuestionIndex]?.id === question.id ? document.getElementById('ai-hint-content') : content;
        if (activeContent) activeContent.textContent = error.message;
        if (activeCard) activeCard.classList.remove('loading');
    } finally {
        hintRequestsInFlight.delete(question.id);
        const activeButton = questions[currentQuestionIndex]?.id === question.id ? document.getElementById('ask-ai-hint-btn') : button;
        if (activeButton) {
            activeButton.disabled = false;
            activeButton.innerHTML = `<span>✨</span> ${questionHints[question.id] ? 'Xem lại gợi ý' : 'Thử hỏi lại AI'}`;
        }
    }
}

function renderFillBlankInput(question, answered) {
    const currentValue = userAnswers[currentQuestionIndex] ?? '';
    let stateClass = '';
    if (answered) stateClass = isQuestionAnswerCorrect(question, currentValue) ? 'correct' : 'wrong';
    return `
        <div class="fill-blank-wrap ${stateClass}">
            <label for="fill-answer-${currentQuestionIndex}">Nhập kết quả số cuối cùng</label>
            <div class="fill-blank-row">
                <input id="fill-answer-${currentQuestionIndex}" class="fill-blank-input" type="text" inputmode="decimal"
                    placeholder="Ví dụ: 12.5" value="${escapeAttribute(currentValue)}"
                    oninput="updateFillBlankAnswer(this.value)"
                    onkeydown="if(event.key === 'Enter') submitFillBlankAnswer()"
                    ${answered ? 'disabled' : ''}>
                <button type="button" class="btn btn-primary fill-check-btn" onclick="submitFillBlankAnswer()" ${answered ? 'disabled' : ''}>Kiểm tra</button>
            </div>
            ${answered ? `<div class="fill-answer-feedback">${stateClass === 'correct' ? '✓ Chính xác!' : `✕ Đáp án đúng: ${escapeAttribute(question.correct_answer)}`}</div>` : ''}
        </div>`;
}

function updateFillBlankAnswer(value) {
    if (answeredQuestions.has(currentQuestionIndex)) return;
    userAnswers[currentQuestionIndex] = value;
}

function submitFillBlankAnswer() {
    if (answeredQuestions.has(currentQuestionIndex)) return;
    const question = questions[currentQuestionIndex];
    const answer = String(userAnswers[currentQuestionIndex] ?? '').trim();
    if (!answer || !Number.isFinite(Number(answer.replace(',', '.')))) {
        showInstantAiFeedback(false, question.correct_answer, 'Hãy nhập một kết quả số hợp lệ trước nhé.');
        return;
    }
    const isCorrect = isQuestionAnswerCorrect(question, answer);
    answeredQuestions.add(currentQuestionIndex);
    if (isCorrect && isBiteSizedLesson()) skillCorrectCount++;
    playAnswerSound(isCorrect);
    showInstantAiFeedback(isCorrect, question.correct_answer);
    renderQuestion();
}

function isQuestionAnswerCorrect(question, answer) {
    if (question.question_type !== 'fill_blank') return answer === question.correct_option;
    const expected = Number(String(question.correct_answer ?? '').trim().replace(',', '.'));
    const actual = Number(String(answer ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
    const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-4);
    return Math.abs(actual - expected) <= tolerance;
}

function escapeAttribute(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getOptionStateClass(option, question, answered) {
    const selected = userAnswers[currentQuestionIndex] === option;
    if (!answered) return selected ? 'selected' : '';
    if (selected && option === question.correct_option) return 'answer-correct';
    if (selected) return 'answer-wrong';
    if (option === question.correct_option) return 'reveal-correct';
    return '';
}

function selectOption(option) {
    if (answeredQuestions.has(currentQuestionIndex)) return;

    userAnswers[currentQuestionIndex] = option;
    const question = questions[currentQuestionIndex];
    const isCorrect = isQuestionAnswerCorrect(question, option);
    answeredQuestions.add(currentQuestionIndex);
    if (isCorrect && isBiteSizedLesson()) skillCorrectCount++;
    playAnswerSound(isCorrect);
    showInstantAiFeedback(isCorrect, question.correct_option);

    renderQuestion();
}

function updateBiteSizedProgress() {
    if (!isBiteSizedLesson() || !questions.length) return;
    const progress = (skillCorrectCount / questions.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;
    const label = document.getElementById('skill-progress-label');
    if (label) label.textContent = `Đã làm đúng ${skillCorrectCount}/${questions.length} câu`;
}

function playAnswerSound(isCorrect) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const context = new AudioContext();
        const notes = isCorrect ? [523.25, 659.25, 783.99] : [246.94, 196];
        notes.forEach((frequency, index) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const start = context.currentTime + index * .09;
            oscillator.type = isCorrect ? 'sine' : 'triangle';
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(.0001, start);
            gain.gain.exponentialRampToValueAtTime(.14, start + .015);
            gain.gain.exponentialRampToValueAtTime(.0001, start + .16);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(start);
            oscillator.stop(start + .18);
        });
        setTimeout(() => context.close(), 700);
    } catch (error) {
        console.debug('Trình duyệt không phát được âm thanh phản hồi:', error);
    }
}

function showInstantAiFeedback(isCorrect, correctOption, customMessage = '') {
    if (isExamMode()) return;
    const feedback = document.getElementById('instant-ai-feedback');
    const title = document.getElementById('instant-ai-title');
    const message = document.getElementById('instant-ai-message');
    if (!feedback || !title || !message) return;

    const correctMessages = [
        'Chính xác! Bạn đang tiến rất tốt 🌟',
        'Xuất sắc! Miếng kiến thức này đã thuộc về bạn.',
        'Đúng rồi! Thanh tiến trình vừa tăng thêm một chút.',
        'Quá ổn! Giữ nhịp này nhé 🚀'
    ];
    const wrongMessages = [
        `Chưa đúng rồi. Đáp án chính xác là ${correctOption}. Mình cùng ghi nhớ nhé!`,
        `Suýt đúng! Đáp án là ${correctOption}. Không sao, câu sau mình làm tốt hơn.`,
        `Mình cần xem lại chỗ này một chút. Đáp án đúng là ${correctOption}.`
    ];
    const messages = isCorrect ? correctMessages : wrongMessages;
    title.textContent = isCorrect ? 'EduBot khen bạn!' : 'EduBot nhắc nhỏ';
    message.textContent = customMessage || messages[Math.floor(Math.random() * messages.length)];
    feedback.classList.remove('correct', 'wrong', 'show');
    void feedback.offsetWidth;
    feedback.classList.add(isCorrect ? 'correct' : 'wrong', 'show');
    clearTimeout(instantFeedbackTimer);
    instantFeedbackTimer = setTimeout(() => feedback.classList.remove('show'), 3200);
}

function hideInstantAiFeedback() {
    const feedback = document.getElementById('instant-ai-feedback');
    if (feedback) feedback.classList.remove('show');
}

function nextQuestion() {
    if (currentQuestionIndex < questions.length - 1) {
        hideInstantAiFeedback();
        currentQuestionIndex++;
        renderQuestion();
    } else {
        submitQuiz();
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        hideInstantAiFeedback();
        currentQuestionIndex--;
        renderQuestion();
    }
}

function startTimer() {
    timerInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const timerEl = document.getElementById('timer');
        if (timerEl) {
            timerEl.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            submitQuiz();
        }
    }, 1000);
}

async function submitQuiz() {
    quizSubmitted = true;
    clearInterval(timerInterval);
    
    let correctCount = 0;
    questions.forEach((q, index) => {
        if (isQuestionAnswerCorrect(q, userAnswers[index])) {
            correctCount++;
        }
    });

    const score = (correctCount / questions.length) * 10;
    
    // Show results in modal
    document.getElementById('final-score').textContent = score.toFixed(1);
    document.getElementById('result-msg').textContent = currentMode === 'practice' && currentSource === 'skill-tree'
        ? `Bạn đã trả lời đúng ${correctCount}/${questions.length} câu. ${score >= 5 ? 'Trạm tiếp theo đã được mở khóa!' : 'Bạn cần đạt ít nhất 5 điểm để mở khóa trạm tiếp theo.'}`
        : `Bạn đã trả lời đúng ${correctCount}/${questions.length} câu hỏi.`;
    document.getElementById('result-modal').style.display = 'flex';

    // Submit to API
    const user = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('token');
    
    try {
        const res = await fetch(`${API_URL}/results`, {
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
                time_spent: currentMode === 'practice' ? 0 : (currentQuiz.duration_minutes * 60) - timeLeft
            })
        });
        const data = await res.json();

        // Show streak notification if a new day was recorded
        if (data.streakUpdated && data.current_streak > 0) {
            showStreakNotification(data.current_streak);
        }
    } catch (error) {
        console.error('Error submitting results:', error);
    }
}

function showStreakNotification(streak) {
    // Remove existing notification if any
    const existing = document.getElementById('streak-toast');
    if (existing) existing.remove();

    const isLongStreak = streak >= 7;
    const toast = document.createElement('div');
    toast.id = 'streak-toast';
    toast.innerHTML = `
        <div style="
            position: fixed; bottom: 30px; right: 30px; z-index: 9999;
            background: linear-gradient(135deg, #FF8A00, #FF4500);
            color: white; padding: 18px 28px; border-radius: 20px;
            box-shadow: 0 15px 40px rgba(255,100,0,0.4);
            display: flex; align-items: center; gap: 14px;
            font-family: 'Outfit', sans-serif;
            animation: streakSlideIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
            max-width: 320px;
        ">
            <span style="font-size: 2.5rem; animation: flamePulse 0.8s ease-in-out infinite alternate;">🔥</span>
            <div>
                <div style="font-weight: 800; font-size: 1.15rem;">
                    ${streak === 1 ? 'Bắt đầu chuỗi học!' : `${streak} ngày liên tiếp!`}
                </div>
                <div style="font-size: 0.85rem; opacity: 0.9; margin-top: 2px;">
                    ${isLongStreak ? '🏆 Thật tuyệt vời! Tiếp tục nhé!' : 'Hãy duy trì streak mỗi ngày!'}
                </div>
            </div>
        </div>
        <style>
            @keyframes streakSlideIn {
                from { transform: translateY(80px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes flamePulse {
                from { transform: scale(1) rotate(-5deg); }
                to { transform: scale(1.2) rotate(5deg); }
            }
        </style>
    `;
    document.body.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(80px)';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
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
    if (currentMode === 'exam' && currentSource === 'exams') {
        const query = currentGrade ? `?grade=${currentGrade}` : '';
        window.location.href = `exams.html${query}`;
        return;
    }

    if (currentMode === 'practice') {
        const query = currentSubjectId
            ? `?subject=${currentSubjectId}${currentGrade ? `&grade=${currentGrade}` : ''}`
            : '';
        const destination = currentSource === 'skill-tree' ? 'skill-tree.html' : 'practice.html';
        window.location.href = `${destination}${query}`;
        return;
    }

    if (currentSubjectId) {
        // Reset state
        document.getElementById('result-modal').style.display = 'none';
        document.getElementById('review-container').style.display = 'none';
        document.getElementById('review-btn').style.display = 'block';
        currentQuestionIndex = 0;
        userAnswers = {};
        quizSubmitted = false;
        pageExitWarnings = 0;
        lastExitWarningAt = 0;
        
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
        if (!isQuestionAnswerCorrect(q, userAnswers[index])) {
            hasWrong = true;
            const expectedAnswer = q.question_type === 'fill_blank' ? q.correct_answer : q.correct_option;
            const item = document.createElement('div');
            item.className = 'wrong-answer-item';
            item.innerHTML = `
                <b>Câu ${index + 1}: ${autoWrapMath(q.content)}</b>
                <p>Bạn chọn: <span class="your-ans">${userAnswers[index] || 'Chưa trả lời'}</span></p>
                <p>Đáp án đúng: <span class="correct-ans">${escapeAttribute(expectedAnswer)}</span></p>
                ${q.explanation ? `<p style="font-size: 0.9rem; color: #64748b; margin-top: 8px;"><i>💡 Giải thích: ${autoWrapMath(q.explanation)}</i></p>` : ''}
            `;
            list.appendChild(item);
        }
    });

    if (!hasWrong) {
        list.innerHTML = '<p style="color: #10b981; font-weight: bold;">Tuyệt vời! Bạn không sai câu nào.</p>';
    }

    // Render KaTeX for review list
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(list, {
            delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false},
                {left: "\\(", right: "\\)", display: false},
                {left: "\\[", right: "\\]", display: true}
            ],
            throwOnError: false
        });
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
        if (isQuestionAnswerCorrect(q, userAnswers[index])) {
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
            if (typeof renderMathInElement === 'function') {
                renderMathInElement(content, {
                    delimiters: [
                        {left: "$$", right: "$$", display: true},
                        {left: "$", right: "$", display: false},
                        {left: "\\(", right: "\\)", display: false},
                        {left: "\\[", right: "\\]", display: true}
                    ],
                    throwOnError: false
                });
            }
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

// Automatically wraps common raw math patterns (e.g. x^2, y = x^2, alpha) into LaTeX delimiters ($...$)
function autoWrapMath(text) {
    if (!text) return '';
    
    // 1. Protect existing LaTeX blocks (both $$...$$ and $...$)
    const placeholders = [];
    let res = text.replace(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g, (match) => {
        placeholders.push(match);
        return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
    });

    const greekMap = {
        'alpha': '\\alpha',
        'beta': '\\beta',
        'gamma': '\\gamma',
        'delta': '\\delta',
        'theta': '\\theta',
        'phi': '\\phi',
        'omega': '\\omega',
        'sigma': '\\sigma',
        'pi': '\\pi'
    };

    // 2. Replace equations: e.g. "y = x^3", "y = x^2 - 4x + 3", "f(x) = x^2", "x = 2"
    res = res.replace(/\b([yfx]\(?[x]?\)?'?\s*=\s*[-+*/^()0-9a-zA-Z\s]+)\b/g, (match) => {
        const replacement = `$${match.trim()}$`;
        placeholders.push(replacement);
        return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
    });

    // 3. Replace exponents: e.g. "x^2", "10^6", "(x+1)^2", "e^-x"
    res = res.replace(/([a-zA-Z0-9]+|\([^)]+\))\^([a-zA-Z0-9{}~_+-]+)/g, (match, base, exp) => {
        const replacement = `$${base}^{${exp}}$`;
        placeholders.push(replacement);
        return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
    });

    // 4. Greek letters replacement
    for (const [key, val] of Object.entries(greekMap)) {
        const regex = new RegExp(`\\b${key}\\b`, 'gi');
        res = res.replace(regex, () => {
            const replacement = `$${val}$`;
            placeholders.push(replacement);
            return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
        });
    }

    // 5. Fractions: e.g. "1/2", "3/4"
    res = res.replace(/\b([0-9a-zA-Z]+)\/([0-9a-zA-Z]+)\b/g, (match, num, den) => {
        const replacement = `$\\frac{${num}}{${den}}$`;
        placeholders.push(replacement);
        return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
    });

    // 6. Integrals
    res = res.replace(/\\int\b/g, () => {
        const replacement = `$\\int$`;
        placeholders.push(replacement);
        return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
    });

    // 7. Restore placeholders
    while (res.includes('___MATH_PLACEHOLDER_')) {
        res = res.replace(/___MATH_PLACEHOLDER_(\d+)___/g, (match, index) => {
            return placeholders[parseInt(index)];
        });
    }

    return res;
}
