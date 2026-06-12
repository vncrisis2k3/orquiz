(function () {
    const STORAGE_KEY = 'eduFlowTheme';
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
        if (document.getElementById('theme-toggle')) return;

        const button = document.createElement('button');
        button.id = 'theme-toggle';
        button.type = 'button';
        button.className = 'theme-toggle';
        button.addEventListener('click', () => {
            applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
        });
        document.body.appendChild(button);
        applyTheme(root.dataset.theme || 'light');
    });
})();
