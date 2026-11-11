// Resolve day/night before first paint so there is no flash of the wrong theme.
// A separate file (not an inline <script>) so the Content-Security-Policy can be `script-src 'self'`:
// allowing inline scripts would also allow any script an attacker manages to inject into the page.
(function () {
  var t = null;
  try { t = localStorage.getItem('bookwyrm-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
})();
