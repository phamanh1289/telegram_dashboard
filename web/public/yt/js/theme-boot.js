/* theme before first paint: saved choice, else the OS preference (no flash) */
{ let t = null; try { t = localStorage.theme; } catch {} document.documentElement.dataset.theme = t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
