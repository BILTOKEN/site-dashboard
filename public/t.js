/* site-dashboard page view tracker. No cookies, no personal data.
   Usage: <script defer src="https://YOUR-DASHBOARD/t.js" data-site="site-id"></script>
   Add ?sd_ignore=1 to any page URL once to stop counting your own visits in that browser
   (?sd_ignore=0 to undo). */
(function () {
  var s = document.currentScript;
  var site = s && s.getAttribute('data-site');
  if (!site) return;
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:') return;
  try {
    var flag = new URLSearchParams(location.search).get('sd_ignore');
    if (flag === '1') localStorage.setItem('sd_ignore', '1');
    if (flag === '0') localStorage.removeItem('sd_ignore');
    if (localStorage.getItem('sd_ignore') === '1') return;
  } catch (e) {}
  var endpoint = s.src.replace(/\/t\.js(\?.*)?$/, '/api/collect');
  var last = '';
  function send() {
    var path = location.pathname;
    if (path === last) return;
    last = path;
    var data = JSON.stringify({ s: site, p: path, r: document.referrer || '' });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, data)) return;
    } catch (e) {}
    try {
      fetch(endpoint, { method: 'POST', body: data, keepalive: true, mode: 'no-cors' });
    } catch (e) {}
  }
  if (document.visibilityState === 'prerender') {
    document.addEventListener('visibilitychange', function once() {
      if (document.visibilityState !== 'prerender') {
        document.removeEventListener('visibilitychange', once);
        send();
      }
    });
  } else {
    send();
  }
})();
