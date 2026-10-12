/* Applies the remembered sheet before first paint (a file, so the page's CSP can forbid inline scripts). */
try { const t = localStorage.getItem("otucalendar.theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
