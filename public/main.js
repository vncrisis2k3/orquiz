const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? 'http://localhost:5000/api' : '/api';
let currentGrade = 12; // Default to Grade 12

document.addEventListener('DOMContentLoaded', async () => {
    updateNavbar();
    await checkUserGrade(); // Fetch user's grade if logged in
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
            <li><a href="roadmap.html">Lộ trình</a></li>
            <li><a href="index.html#ranking">Bảng xếp hạng</a></li>
            <li><a href="profile.html" class="btn btn-outline">Trang cá nhân</a></li>
            <li><a href="#" onclick="logout()" class="btn btn-primary">Đăng xuất</a></li>
        `;
    } else {
        if (heroSection) heroSection.style.display = 'block';
        navLinks.innerHTML = `
            <li><a href="#subjects">Kiểm tra</a></li>
            <li><a href="#ranking">Bảng xếp hạng</a></li>
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
                    <a href="#" onclick="checkAuthAndGo(${subject.id})" class="link">Làm bài →</a>
                `;
                subjectGrid.appendChild(card);
            });
            window.refreshReveal();
        }
    } catch (error) {
        console.error('Error fetching subjects:', error);
    }
}

function checkAuthAndGo(subjectId) {
    if (localStorage.getItem('token')) {
        // Automatically use currentGrade which is now synced with user profile
        window.location.href = `quiz.html?subject=${subjectId}&grade=${currentGrade}`;
    } else {
        alert('Vui lòng đăng nhập để thực hiện bài thi!');
        window.location.href = 'auth.html';
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
