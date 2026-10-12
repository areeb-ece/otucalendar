/* Offline fallback for the light/dark sheet. Online, /design/theme.js (loaded just before
   this) has already applied the visitor's shared settings and this does nothing. */
try { if (!window.SiteDesign) { const t = localStorage.getItem("otucalendar.theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } } catch (e) {}
