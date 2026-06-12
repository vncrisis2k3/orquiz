const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? 'http://localhost:5000/api' : '/api';
let currentGrade = 12; // Default to Grade 12

document.addEventListener('DOMContentLoaded', async () => {
    updateNavbar();
    await checkUserGrade();
    fetchSubjects();
    fetchLeaderboard();
    initScrollReveal();
});

async function checkUserGrade() {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const res = await fetch(`${API_URL}/auth/user`, {
                headers: { 'x-auth-token': token }
            });
            if (res.ok) {
                const user = await res.json();
                
                // Update streak count on navbar
                const streakEl = document.getElementById('nav-streak-count');
                if (streakEl) {
                    streakEl.textContent = user.current_streak || 0;
                }

                if (user.survey_data) {
                    const survey = typeof user.survey_data === 'string' ? JSON.parse(user.survey_data) : user.survey_data;
                    if (survey.grade) {
                        currentGrade = parseInt(survey.grade);
                        selectGrade(currentGrade);
                        console.log("Auto-selected user grade:", currentGrade);
                        
                        // Add a badge to the grade button
                        const activeBtn = document.querySelector(`.grade-btn[data-grade="${currentGrade}"]`);
                        if (activeBtn) {
                            activeBtn.innerHTML += ' <small>(Phù hợp)</small>';
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Error checking user grade:", err);
        }
    }
}

function initScrollReveal() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                if (entry.target.classList.contains('reveal')) {
                    observer.unobserve(entry.target);
                }
            }
        });
    }, observerOptions);

    // Initial reveal elements
    document.querySelectorAll('.reveal, .stagger-reveal').forEach(el => {
        observer.observe(el);
    });

    // Re-run observer for dynamically added elements if needed
    window.refreshReveal = () => {
        document.querySelectorAll('.reveal:not(.active), .stagger-reveal:not(.active)').forEach(el => {
            observer.observe(el);
        });
    };
}

function updateNavbar() {
    const navLinks = document.querySelector('.nav-links');
    const user = JSON.parse(localStorage.getItem('user'));
    const heroSection = document.getElementById('hero-section');
    
    if (user) {
        if (heroSection) heroSection.style.display = 'none';
        navLinks.innerHTML = `
            <li><a href="index.html#subjects">Kiểm tra</a></li>
            <li><a href="practice.html">Luyện tập</a></li>
            <li><a href="roadmap.html">Lộ trình</a></li>
            <li><a href="leaderboard.html">Bảng xếp hạng</a></li>
            <li><a href="profile.html" class="btn btn-outline">Trang cá nhân</a></li>
            <li><a href="#" onclick="logout()" class="btn btn-primary">Đăng xuất</a></li>
            <li class="nav-streak-item">
                <a href="profile.html" class="nav-streak-badge">
                    🔥 <span id="nav-streak-count">0</span>
                </a>
            </li>
        `;
    } else {
        if (heroSection) heroSection.style.display = 'block';
        navLinks.innerHTML = `
            <li><a href="#subjects">Kiểm tra</a></li>
            <li><a href="practice.html">Luyện tập</a></li>
            <li><a href="leaderboard.html">Bảng xếp hạng</a></li>
            <li><a href="auth.html" class="btn btn-outline">Đăng nhập</a></li>
            <li><a href="auth.html" class="btn btn-primary">Bắt đầu ngay</a></li>
        `;
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.reload();
}

async function fetchLeaderboard() {
    const leaderboardBody = document.getElementById('leaderboard-body');
    if (!leaderboardBody) return;
    
    try {
        const response = await fetch(`${API_URL}/leaderboard`);
        const leaders = await response.json();

        if (leaders.length > 0) {
            leaderboardBody.innerHTML = '';

            leaders.forEach(user => {
                const row = document.createElement('tr');
                row.className = `rank-${user.rank_position}`;
                
                row.innerHTML = `
                    <td><div class="rank-badge">${user.rank_position}</div></td>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar">${user.username.charAt(0).toUpperCase()}</div>
                            <span>${user.full_name || user.username}</span>
                        </div>
                    </td>
                    <td>Level ${user.level}</td>
                    <td class="points-cell">${user.total_points.toLocaleString()} pts</td>
                `;
                leaderboardBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
    }
}

async function fetchSubjects() {
    const subjectGrid = document.querySelector('.subject-grid');
    
    try {
        const response = await fetch(`${API_URL}/subjects`);
        const subjects = await response.json();

        if (subjects.length > 0) {
            // Clear existing hardcoded subjects
            subjectGrid.innerHTML = '';

            subjects.forEach((subject, index) => {
                const card = document.createElement('div');
                card.className = 'subject-card stagger-reveal';
                card.style.transitionDelay = `${index * 0.1}s`;
                
                // Assign icon based on slug
                const icon = getSubjectIcon(subject.slug);
                
                card.innerHTML = `
                    <div class="subject-icon ${icon.color}">${icon.emoji}</div>
                    <h3>${subject.name}</h3>
                    <p>Khám phá kho tàng kiến thức môn ${subject.name}</p>
                    <a href="#" onclick="checkAuthAndGo(${subject.id}, event)" class="link">Làm bài →</a>
                `;
                subjectGrid.appendChild(card);
            });
            window.refreshReveal();
            
            // Build the global floating chatbot
            initFloatingChatbot(subjects);
        }
    } catch (error) {
        console.error('Error fetching subjects:', error);
    }
}

let selectedSubjectIdForModal = null;
let selectedQuizMode = 'exam'; // Default to exam mode

function checkAuthAndGo(subjectId, event) {
    if (event) event.preventDefault();
    if (localStorage.getItem('token')) {
        selectedSubjectIdForModal = subjectId;
        selectedQuizMode = 'exam';
        
        // Show the modal
        const modal = document.getElementById('mode-select-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.alignItems = 'flex-start';
            modal.style.paddingTop = 'max(20px, calc(env(safe-area-inset-top) + 20px))';
            modal.scrollTop = 0;
            document.body.style.overflow = 'hidden';
            const modalCard = modal.querySelector('.result-modal');
            if (modalCard) modalCard.scrollIntoView({ block: 'start' });
            updateModalOptionActiveState();
        } else {
            // Fallback if modal is not found for some reason
            window.location.href = `quiz.html?subject=${subjectId}&grade=${currentGrade}`;
        }
    } else {
        alert('Vui lòng đăng nhập để thực hiện bài thi!');
        window.location.href = 'auth.html';
    }
}

function updateModalOptionActiveState() {
    const optExam = document.getElementById('opt-exam');
    const optPractice = document.getElementById('opt-practice');
    if (!optExam || !optPractice) return;
    
    if (selectedQuizMode === 'exam') {
        optExam.style.borderColor = 'var(--primary)';
        optExam.style.background = '#FFFBF8';
        optExam.classList.add('active');
        
        optPractice.style.borderColor = '#E2E8F0';
        optPractice.style.background = '#F8FAFC';
        optPractice.classList.remove('active');
    } else {
        optPractice.style.borderColor = 'var(--primary)';
        optPractice.style.background = '#FFFBF8';
        optPractice.classList.add('active');
        
        optExam.style.borderColor = '#E2E8F0';
        optExam.style.background = '#F8FAFC';
        optExam.classList.remove('active');
    }
}

function selectQuizMode(mode) {
    selectedQuizMode = mode;
    updateModalOptionActiveState();
}

function closeModeSelectModal() {
    const modal = document.getElementById('mode-select-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function startSelectedQuiz() {
    if (selectedSubjectIdForModal) {
        window.location.href = `quiz.html?subject=${selectedSubjectIdForModal}&grade=${currentGrade}&mode=${selectedQuizMode}`;
    }
}

function selectGrade(grade) {
    currentGrade = grade;
    
    // Update UI buttons
    document.querySelectorAll('.grade-btn').forEach(btn => {
        if (btn.getAttribute('data-grade') == grade) {
            btn.classList.remove('btn-outline');
            btn.classList.add('btn-primary');
        } else {
            btn.classList.add('btn-outline');
            btn.classList.remove('btn-primary');
        }
    });
    
    console.log(`Selected Grade: ${currentGrade}`);
}

function getSubjectIcon(slug) {
    const icons = {
        'toan': { emoji: '📐', color: 'orange' },
        'ly': { emoji: '⚡', color: 'red' },
        'hoa': { emoji: '🧪', color: 'yellow' },
        'sinh': { emoji: '🧬', color: 'green' },
        'su': { emoji: '📜', color: 'blue' },
        'dia': { emoji: '🌍', color: 'purple' },
        'van': { emoji: '🖋️', color: 'brown' },
        'tin': { emoji: '💻', color: 'cyan' },
        'anh': { emoji: '🔤', color: 'red' }
    };
    return icons[slug] || { emoji: '📚', color: 'orange' };
}

let chatHistory = [];

function initFloatingChatbot() {
    const token = localStorage.getItem('token');
    if (!token) return;

    if (document.getElementById('floating-chat-container')) return;

    let userId = 'default';
    try {
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        if (user && user.id) userId = user.id;
    } catch (err) {
        console.error('Could not read chatbot user:', err);
    }
    const chatStorageKey = `chatHistory_${userId}`;

    try {
        const savedHistory = JSON.parse(localStorage.getItem(chatStorageKey) || '[]');
        chatHistory = Array.isArray(savedHistory) ? savedHistory.slice(-20) : [];
    } catch (err) {
        chatHistory = [];
        console.error('Could not restore chatbot history:', err);
    }

    const saveChatHistory = () => {
        chatHistory = chatHistory.slice(-20);
        localStorage.setItem(chatStorageKey, JSON.stringify(chatHistory));
    };

    // Create container
    const container = document.createElement('div');
    container.id = 'floating-chat-container';
    container.style.position = 'fixed';
    container.style.bottom = '30px';
    container.style.right = '30px';
    container.style.zIndex = '9999';
    container.style.fontFamily = "'Outfit', sans-serif";
    container.style.touchAction = 'none';

    // Build the Floating Bubble Button
    const bubble = document.createElement('div');
    bubble.id = 'chat-bubble-btn';
    bubble.style.width = '60px';
    bubble.style.height = '60px';
    bubble.style.borderRadius = '50%';
    bubble.style.background = 'linear-gradient(135deg, #FF8A00, #FF4500)';
    bubble.style.color = 'white';
    bubble.style.display = 'flex';
    bubble.style.alignItems = 'center';
    bubble.style.justifyContent = 'center';
    bubble.style.fontSize = '1.6rem';
    bubble.style.cursor = 'pointer';
    bubble.style.userSelect = 'none';
    bubble.style.boxShadow = '0 10px 30px rgba(255,138,0,0.4)';
    bubble.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    bubble.innerHTML = '💬';
    
    bubble.onmouseover = () => {
        bubble.style.transform = 'scale(1.1) rotate(-8deg)';
        bubble.style.boxShadow = '0 15px 35px rgba(255,138,0,0.6)';
    };
    bubble.onmouseout = () => {
        bubble.style.transform = 'scale(1) rotate(0deg)';
        bubble.style.boxShadow = '0 10px 30px rgba(255,138,0,0.4)';
    };

    // Build the Chat Window Panel
    const panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.style.width = '380px';
    panel.style.height = '520px';
    panel.style.borderRadius = '24px';
    panel.style.background = 'white';
    panel.style.boxShadow = '0 15px 50px rgba(0,0,0,0.15)';
    panel.style.display = 'none';
    panel.style.flexDirection = 'column';
    panel.style.overflow = 'hidden';
    panel.style.border = '1px solid rgba(255, 122, 0, 0.15)';
    panel.style.position = 'absolute';
    panel.style.bottom = '75px';
    panel.style.right = '0';
    panel.style.transition = 'all 0.3s ease';

    // Header HTML
    const headerHTML = `
        <div style="background: linear-gradient(135deg, #1E293B, #0F172A); color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; user-select: none;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.2rem;">🤖</span>
                <div>
                    <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700;">StudyFlow</h4>
                    <span style="font-size: 0.72rem; color: #10B981; font-weight: 600;">● Đang hoạt động</span>
                </div>
            </div>
            <span id="close-chat-btn" style="cursor: pointer; font-size: 1.2rem; font-weight: 700; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8">×</span>
        </div>
    `;

    // Message Box
    const messagesBox = document.createElement('div');
    messagesBox.id = 'chat-panel-messages';
    messagesBox.style.flex = '1';
    messagesBox.style.padding = '15px';
    messagesBox.style.overflowY = 'auto';
    messagesBox.style.background = '#F8FAFC';
    messagesBox.style.display = 'flex';
    messagesBox.style.flexDirection = 'column';
    messagesBox.style.gap = '12px';

    // Input Bar
    const inputBar = document.createElement('div');
    inputBar.style.padding = '12px 15px';
    inputBar.style.background = 'white';
    inputBar.style.borderTop = '1px solid #E2E8F0';
    inputBar.style.display = 'flex';
    inputBar.style.gap = '8px';
    inputBar.style.alignItems = 'center';

    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.placeholder = 'Nhập câu hỏi của bạn...';
    inputField.style.flex = '1';
    inputField.style.padding = '10px 16px';
    inputField.style.borderRadius = '12px';
    inputField.style.border = '1.5px solid #E2E8F0';
    inputField.style.outline = 'none';
    inputField.style.fontSize = '0.88rem';
    inputField.style.fontFamily = 'inherit';
    inputField.style.transition = 'border-color 0.2s';
    inputField.onfocus = () => { inputField.style.borderColor = '#FF8A00'; };
    inputField.onblur = () => { inputField.style.borderColor = '#E2E8F0'; };

    const sendBtn = document.createElement('button');
    sendBtn.innerHTML = 'Gửi';
    sendBtn.style.background = 'linear-gradient(135deg, #FF8A00, #FF4500)';
    sendBtn.style.color = 'white';
    sendBtn.style.border = 'none';
    sendBtn.style.padding = '10px 18px';
    sendBtn.style.borderRadius = '12px';
    sendBtn.style.fontWeight = '700';
    sendBtn.style.fontSize = '0.85rem';
    sendBtn.style.cursor = 'pointer';
    sendBtn.style.boxShadow = '0 4px 12px rgba(255,100,0,0.2)';
    
    // Assemble panel elements
    panel.innerHTML = headerHTML;
    panel.appendChild(messagesBox);
    inputBar.appendChild(inputField);
    inputBar.appendChild(sendBtn);
    panel.appendChild(inputBar);

    container.appendChild(bubble);
    container.appendChild(panel);
    document.body.appendChild(container);

    let dragStartX = 0;
    let dragStartY = 0;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let isDraggingChat = false;
    let didMoveChat = false;
    const mobileChatQuery = window.matchMedia('(max-width: 768px)');

    const resetMobileChatPosition = () => {
        if (!mobileChatQuery.matches) return;
        isDraggingChat = false;
        didMoveChat = false;
        container.style.left = 'auto';
        container.style.top = 'auto';
        container.style.right = '14px';
        container.style.bottom = '14px';
        container.style.width = '60px';
        container.style.height = '60px';
        container.style.touchAction = 'auto';
        bubble.style.transform = 'none';
    };

    const closeChatPanel = () => {
        panel.style.display = 'none';
        bubble.innerHTML = '💬';
        container.classList.remove('chat-open');
        document.body.classList.remove('mobile-chat-open');
        resetMobileChatPosition();
    };

    const clampChatPosition = (left, top) => {
        const rect = container.getBoundingClientRect();
        const margin = 10;
        const maxLeft = window.innerWidth - rect.width - margin;
        const maxTop = window.innerHeight - rect.height - margin;
        return {
            left: Math.min(Math.max(margin, left), Math.max(margin, maxLeft)),
            top: Math.min(Math.max(margin, top), Math.max(margin, maxTop))
        };
    };

    bubble.addEventListener('pointerdown', (e) => {
        if (mobileChatQuery.matches) return;
        if (panel.style.display !== 'none') return;
        isDraggingChat = true;
        didMoveChat = false;
        const rect = container.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        bubble.setPointerCapture(e.pointerId);
        bubble.style.transition = 'none';
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        container.style.left = `${rect.left}px`;
        container.style.top = `${rect.top}px`;
    });

    bubble.addEventListener('pointermove', (e) => {
        if (mobileChatQuery.matches) return;
        if (!isDraggingChat) return;
        const moved = Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY);
        if (moved > 6) didMoveChat = true;
        if (!didMoveChat) return;
        const pos = clampChatPosition(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
        container.style.left = `${pos.left}px`;
        container.style.top = `${pos.top}px`;
    });

    bubble.addEventListener('pointerup', (e) => {
        if (mobileChatQuery.matches) return;
        if (!isDraggingChat) return;
        isDraggingChat = false;
        bubble.releasePointerCapture(e.pointerId);
        bubble.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        if (didMoveChat) {
            e.preventDefault();
            e.stopPropagation();
            setTimeout(() => { didMoveChat = false; }, 0);
        }
    });

    bubble.addEventListener('pointercancel', () => {
        isDraggingChat = false;
        didMoveChat = false;
        resetMobileChatPosition();
    });

    const handleChatViewportChange = () => {
        if (mobileChatQuery.matches) {
            resetMobileChatPosition();
            if (panel.style.display !== 'none') {
                document.body.classList.add('mobile-chat-open');
            }
            return;
        }
        document.body.classList.remove('mobile-chat-open');
        if (panel.style.display !== 'none') {
            positionChatPanel();
            return;
        }
        const rect = container.getBoundingClientRect();
        const pos = clampChatPosition(rect.left, rect.top);
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        container.style.left = `${pos.left}px`;
        container.style.top = `${pos.top}px`;
    };

    window.addEventListener('resize', handleChatViewportChange);
    window.visualViewport?.addEventListener('resize', handleChatViewportChange);
    mobileChatQuery.addEventListener('change', handleChatViewportChange);
    resetMobileChatPosition();

    const positionChatPanel = () => {
        if (mobileChatQuery.matches) {
            panel.style.inset = '0';
            panel.style.width = '100vw';
            panel.style.height = '100dvh';
            return;
        }

        panel.style.inset = 'auto';
        panel.style.width = '380px';
        panel.style.height = '520px';
        const rect = container.getBoundingClientRect();
        const panelWidth = Math.min(380, window.innerWidth - 28);
        const panelHeight = Math.min(520, window.innerHeight - 110);

        panel.style.left = rect.left + panelWidth > window.innerWidth - 14 ? 'auto' : '0';
        panel.style.right = rect.left + panelWidth > window.innerWidth - 14 ? '0' : 'auto';
        panel.style.top = rect.top < panelHeight + 85 ? '75px' : 'auto';
        panel.style.bottom = rect.top < panelHeight + 85 ? 'auto' : '75px';
    };

    // Toggle Chat
    bubble.onclick = (e) => {
        if (didMoveChat) {
            e.preventDefault();
            return;
        }
        if (panel.style.display === 'none') {
            resetMobileChatPosition();
            positionChatPanel();
            panel.style.display = 'flex';
            bubble.innerHTML = '×';
            container.classList.add('chat-open');
            if (mobileChatQuery.matches) {
                document.body.classList.add('mobile-chat-open');
            }
            inputField.focus();
        } else {
            closeChatPanel();
        }
    };

    // Close Button Action
    panel.querySelector('#close-chat-btn').onclick = (e) => {
        e.stopPropagation();
        closeChatPanel();
    };

    if (chatHistory.length > 0) {
        chatHistory.forEach(msg => {
            if (msg.isUser) {
                appendPanelUserMessage(msg.text);
            } else {
                appendPanelBotMessage(msg.text);
            }
        });
    } else {
        appendPanelBotMessage('Chào bạn! Mình là StudyFlow. Bạn có thể hỏi mình về bất kỳ môn học nào.');
    }

    // Send logic
    const handleSend = async () => {
        const msgText = inputField.value.trim();
        if (!msgText) return;

        inputField.value = '';
        appendPanelUserMessage(msgText);

        const typingId = appendPanelTypingIndicator();

        try {
            const formattedHistory = [];
            const lastHistory = chatHistory.slice(-6);
            lastHistory.forEach(msg => {
                formattedHistory.push({
                    role: msg.isUser ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });

            const res = await fetch(`${API_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({
                    message: msgText,
                    history: formattedHistory
                })
            });

            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            if (res.ok) {
                const data = await res.json();
                appendPanelBotMessage(data.reply);
                chatHistory.push({ isUser: true, text: msgText });
                chatHistory.push({ isUser: false, text: data.reply });
                saveChatHistory();
            } else {
                appendPanelBotMessage('❌ Không thể nhận phản hồi từ AI lúc này.');
            }
        } catch (err) {
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();
            appendPanelBotMessage('❌ Lỗi kết nối mạng.');
        }
    };

    sendBtn.onclick = handleSend;
    inputField.onkeypress = (e) => {
        if (e.key === 'Enter') handleSend();
    };

    function appendPanelUserMessage(text) {
        const wrap = document.createElement('div');
        wrap.style.alignSelf = 'flex-end';
        wrap.style.maxWidth = '85%';
        wrap.style.background = 'linear-gradient(135deg, #FF8A00, #FF4500)';
        wrap.style.color = 'white';
        wrap.style.padding = '10px 14px';
        wrap.style.borderRadius = '16px 16px 4px 16px';
        wrap.style.fontSize = '0.85rem';
        wrap.style.lineHeight = '1.4';
        const mathWrapped = autoWrapMath(text);
        wrap.textContent = mathWrapped;
        messagesBox.appendChild(wrap);

        // Render KaTeX for user message
        if (typeof renderMathInElement === 'function') {
            renderMathInElement(wrap, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false},
                    {left: "\\[", right: "\\]", display: true}
                ],
                throwOnError: false
            });
        }

        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    function appendPanelBotMessage(markdownText) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-panel-bot-message';
        wrap.style.alignSelf = 'flex-start';
        wrap.style.maxWidth = '85%';
        wrap.style.background = 'white';
        wrap.style.color = '#1E293B';
        wrap.style.padding = '10px 14px';
        wrap.style.borderRadius = '16px 16px 16px 4px';
        wrap.style.fontSize = '0.85rem';
        wrap.style.lineHeight = '1.4';
        wrap.style.border = '1px solid #F1F5F9';
        const mathWrapped = autoWrapMath(markdownText);
        wrap.innerHTML = renderSimpleMarkdown(mathWrapped);
        messagesBox.appendChild(wrap);

        // Render KaTeX for bot message
        if (typeof renderMathInElement === 'function') {
            renderMathInElement(wrap, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false},
                    {left: "\\[", right: "\\]", display: true}
                ],
                throwOnError: false
            });
        }

        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    function appendPanelTypingIndicator() {
        const id = 'typing-' + Date.now();
        const wrap = document.createElement('div');
        wrap.id = id;
        wrap.className = 'chat-panel-bot-message';
        wrap.style.alignSelf = 'flex-start';
        wrap.style.background = 'white';
        wrap.style.padding = '10px 14px';
        wrap.style.borderRadius = '16px 16px 16px 4px';
        wrap.style.border = '1px solid #F1F5F9';
        wrap.innerHTML = `
            <div style="display:flex; gap:4px; align-items:center; padding: 2px 4px;">
                <span class="dot-bounce" style="width:6px; height:6px; background:#64748B; border-radius:50%; animation: bounce 1.4s infinite ease-in-out both;"></span>
                <span class="dot-bounce" style="width:6px; height:6px; background:#64748B; border-radius:50%; animation: bounce 1.4s infinite ease-in-out both; animation-delay: 0.2s;"></span>
                <span class="dot-bounce" style="width:6px; height:6px; background:#64748B; border-radius:50%; animation: bounce 1.4s infinite ease-in-out both; animation-delay: 0.4s;"></span>
            </div>
            <style>
                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
            </style>
        `;
        messagesBox.appendChild(wrap);
        messagesBox.scrollTop = messagesBox.scrollHeight;
        return id;
    }

    function renderSimpleMarkdown(text) {
        if (!text) return '';
        // Don't escape HTML characters inside LaTeX formulas ($...$) to prevent breaking KaTeX formatting
        // Let's escape text, but we can do a simpler replacement
        return text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/^### (.*$)/gim, '<h5 style="margin:8px 0 4px;font-weight:700;">$1</h5>')
            .replace(/^## (.*$)/gim, '<h4 style="margin:10px 0 4px;font-weight:700;">$1</h4>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/`([^`]+)`/gim, '<code style="background:#f1f5f9;padding:2px 4px;border-radius:4px;font-family:monospace;font-size:0.9em;">$1</code>')
            .replace(/\n/gim, '<br>');
    }

    // Helper: Wrap common raw math expressions into LaTeX delimiters ($...$)
    function autoWrapMath(text) {
        if (!text) return '';
        
        // 1. Protect existing LaTeX blocks (both $$...$$ and $...$)
        const placeholders = [];
        let res = text.replace(/(\$\$[\s\S]+?\ $\$|\$[\s\S]+?\$)/g, (match) => {
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
}
