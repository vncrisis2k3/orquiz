(function () {
    const STORAGE_KEY = 'eduFlowTheme';
    const POSITION_KEY = 'eduFlowThemeTogglePosition';
    const root = document.documentElement;

    function getInitialTheme() {
        const savedTheme = localStorage.getItem(STORAGE_KEY);
        if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        localStorage.setItem(STORAGE_KEY, theme);
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));

        const button = document.getElementById('theme-toggle');
        if (button) {
            const isDark = theme === 'dark';
            button.textContent = isDark ? '☀' : '☾';
            button.setAttribute('aria-label', isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối');
            button.title = isDark ? 'Chế độ sáng' : 'Chế độ tối';
        }
    }

    applyTheme(getInitialTheme());

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.navbar .container').forEach((container, index) => {
            const navLinks = container.querySelector('.nav-links');
            if (!navLinks || container.querySelector('.nav-menu-toggle')) return;

            if (!navLinks.id) {
                navLinks.id = `nav-menu-${index + 1}`;
            }

            const menuButton = document.createElement('button');
            menuButton.type = 'button';
            menuButton.className = 'nav-menu-toggle';
            menuButton.setAttribute('aria-label', 'Mở menu điều hướng');
            menuButton.setAttribute('aria-controls', navLinks.id);
            menuButton.setAttribute('aria-expanded', 'false');
            menuButton.innerHTML = '<span></span><span></span><span></span>';

            function setMenuOpen(isOpen) {
                navLinks.classList.toggle('is-open', isOpen);
                menuButton.classList.toggle('is-open', isOpen);
                menuButton.setAttribute('aria-expanded', String(isOpen));
                menuButton.setAttribute('aria-label', isOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng');
            }

            menuButton.addEventListener('click', (event) => {
                event.stopPropagation();
                setMenuOpen(!navLinks.classList.contains('is-open'));
            });

            navLinks.addEventListener('click', (event) => {
                if (event.target.closest('a')) setMenuOpen(false);
            });

            document.addEventListener('click', (event) => {
                if (!container.contains(event.target)) setMenuOpen(false);
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') setMenuOpen(false);
            });

            window.addEventListener('resize', () => {
                if (window.innerWidth > 768) setMenuOpen(false);
            });

            container.insertBefore(menuButton, navLinks);
        });

        if (document.getElementById('theme-toggle')) return;

        const button = document.createElement('button');
        button.id = 'theme-toggle';
        button.type = 'button';
        button.className = 'theme-toggle';
        let isDragging = false;
        let didMove = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let dragStartX = 0;
        let dragStartY = 0;

        function clampPosition(left, top) {
            const margin = 10;
            const width = button.offsetWidth || 48;
            const height = button.offsetHeight || 48;
            return {
                left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
                top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin))
            };
        }

        function setButtonPosition(left, top, save = false) {
            const position = clampPosition(left, top);
            button.style.left = `${position.left}px`;
            button.style.top = `${position.top}px`;
            button.style.right = 'auto';
            button.style.bottom = 'auto';
            if (save) {
                localStorage.setItem(POSITION_KEY, JSON.stringify({
                    x: position.left / Math.max(1, window.innerWidth - button.offsetWidth),
                    y: position.top / Math.max(1, window.innerHeight - button.offsetHeight)
                }));
            }
        }

        function restoreButtonPosition() {
            try {
                const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
                if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                    setButtonPosition(
                        saved.x * Math.max(1, window.innerWidth - button.offsetWidth),
                        saved.y * Math.max(1, window.innerHeight - button.offsetHeight)
                    );
                    return;
                }
            } catch (err) {
                localStorage.removeItem(POSITION_KEY);
            }

            const rect = button.getBoundingClientRect();
            setButtonPosition(rect.left, rect.top);
        }

        button.addEventListener('pointerdown', (event) => {
            isDragging = true;
            didMove = false;
            const rect = button.getBoundingClientRect();
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            dragOffsetX = event.clientX - rect.left;
            dragOffsetY = event.clientY - rect.top;
            button.setPointerCapture(event.pointerId);
            button.classList.add('dragging');
        });

        button.addEventListener('pointermove', (event) => {
            if (!isDragging) return;
            if (Math.abs(event.clientX - dragStartX) + Math.abs(event.clientY - dragStartY) > 5) {
                didMove = true;
            }
            if (!didMove) return;
            setButtonPosition(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
        });

        button.addEventListener('pointerup', (event) => {
            if (!isDragging) return;
            isDragging = false;
            button.releasePointerCapture(event.pointerId);
            button.classList.remove('dragging');
            if (didMove) {
                const rect = button.getBoundingClientRect();
                setButtonPosition(rect.left, rect.top, true);
                setTimeout(() => { didMove = false; }, 0);
            }
        });

        button.addEventListener('pointercancel', () => {
            isDragging = false;
            didMove = false;
            button.classList.remove('dragging');
            restoreButtonPosition();
        });

        button.addEventListener('click', (event) => {
            if (didMove) {
                event.preventDefault();
                return;
            }
            applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
        });
        document.body.appendChild(button);
        applyTheme(root.dataset.theme || 'light');
        restoreButtonPosition();
        window.addEventListener('resize', restoreButtonPosition);
        window.visualViewport?.addEventListener('resize', restoreButtonPosition);
    });
})();
