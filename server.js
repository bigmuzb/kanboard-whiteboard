// Kanboard Whiteboard — Production Server
// Static files + Kanboard proxy + Auth (magic links) + Admin API + Prefs

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

// ===== Configuration =====
const PORT = process.env.PORT || 3000;
const KANBOARD_URL = process.env.KANBOARD_URL || 'http://kanboard:80/jsonrpc.php';
const KANBOARD_USER = process.env.KANBOARD_USER || 'jsonrpc';
const KANBOARD_KEY = process.env.KANBOARD_KEY || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'kanboard-whiteboard-admin-' + require('crypto').randomBytes(8).toString('hex');
const BRAND_NAME = process.env.BRAND_NAME || 'Kanboard Whiteboard';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const UMAMI_SCRIPT_URL = process.env.UMAMI_SCRIPT_URL || process.env.UMAMI_TRACKING_SCRIPT || '';
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || '';
const UMAMI_DOMAINS = process.env.UMAMI_DOMAINS || '';
const DEMO_ALLOWED_API_METHODS = new Set([
  'getAllProjects',
  'getProjectUsers',
  'getBoard',
  'getAllComments',
  'moveTaskPosition',
]);

// ===== MIME Types =====
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};


function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function analyticsSnippet() {
  if (!UMAMI_SCRIPT_URL || !UMAMI_WEBSITE_ID) return '';
  try {
    const parsed = new URL(UMAMI_SCRIPT_URL);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  } catch {
    return '';
  }

  const domains = UMAMI_DOMAINS
    ? ` data-domains="${escapeHtmlAttr(UMAMI_DOMAINS)}"`
    : '';

  return `<script defer src="${escapeHtmlAttr(UMAMI_SCRIPT_URL)}" data-website-id="${escapeHtmlAttr(UMAMI_WEBSITE_ID)}"${domains}></script>`;
}

function injectAnalytics(html) {
  const snippet = analyticsSnippet();
  if (!snippet) return html;
  if (html.includes('data-website-id=') || html.includes('data-website-id="')) return html;
  return html.replace('</head>', `  ${snippet}\n</head>`);
}

// ===== Init =====
auth.init();

// ===== Server =====
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // === PUBLIC ROUTES (no auth) ===

  // Magic link login
  if (pathname === '/auth/login' && req.method === 'GET') {
    return handleMagicLogin(req, res, url);
  }

  // Public demo login. Only enabled when DEMO_MODE=true.
  if (pathname === '/demo-login' && req.method === 'GET') {
    return handleDemoLogin(req, res);
  }

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  // Dynamic config.js — injects environment variables into frontend
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(`const CONFIG = {\n  API_URL: '/api',\n  REFRESH_INTERVAL: 30000,\n  BRAND_NAME: ${JSON.stringify(BRAND_NAME)},\n  DEMO_MODE: ${DEMO_MODE ? 'true' : 'false'},\n};`);
    return;
  }

  // Dynamic manifest.json — brand-aware PWA manifest
  if (pathname === '/manifest.json') {
    const shortName = BRAND_NAME.split(/\s+/).map(w => w[0]).join('') + ' Board';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: BRAND_NAME + ' Board',
      short_name: shortName,
      description: 'Task management board for ' + BRAND_NAME,
      start_url: '/',
      display: 'standalone',
      background_color: '#1a1a22',
      theme_color: '#1a1a22',
      orientation: 'any',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }, null, 2));
    return;
  }

  // Service worker (must be public for PWA)
  if (pathname === '/sw.js') {
    return serveStatic(req, res);
  }

  // NOTOOL logo (dark-mode: 'no' white, 'tool' coral)
  if (pathname === '/logo.svg' || pathname === '/logo.png') {
    const svg = `<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 960 560" width="120" height="70"><style>.nt0{fill:#c3402f}.nt1{fill:#ffffff}</style><path class="nt1" d="M163.7,296.9v75.6h-37.2v-135.5h37.2v15.1c11.2-11.6,23.9-17.4,38-17.4s25.8,5,35.3,15.1c9.5,10.1,14.3,23.5,14.3,40.3v82.4h-37.2v-76.6c0-20.8-7.5-31.2-22.6-31.2s-13.9,2.7-19.5,8.2c-5.5,5.5-8.3,13.5-8.3,24.1Z"/><path class="nt1" d="M403.6,304.7c0,19.6-6.7,36.2-20.1,49.6-13.4,13.4-30.2,20.1-50.5,20.1s-37.1-6.7-50.5-20.1c-13.4-13.4-20.1-30-20.1-49.6s6.7-36.2,20.1-49.7c13.4-13.5,30.2-20.3,50.5-20.3s37.1,6.8,50.5,20.3c13.4,13.5,20.1,30.1,20.1,49.7ZM299.9,304.7c0,11.1,3.1,20.1,9.3,27.1,6.2,7,14.1,10.5,23.8,10.5s17.6-3.5,23.8-10.5c6.2-7,9.3-16,9.3-27.1s-3.1-20.2-9.3-27.2c-6.2-7.1-14.1-10.6-23.8-10.6s-17.6,3.5-23.8,10.6c-6.2,7.1-9.3,16.1-9.3,27.2Z"/><path class="nt0" d="M455.7,264.1v60.7c0,5.2,1.3,9.3,4,12.2,2.6,2.9,5.8,4.4,9.4,4.4,6.9,0,12.8-3.2,17.6-9.6l13.9,26.4c-11.6,10.7-23.8,16.1-36.6,16.1s-23.7-4.3-32.5-12.8c-8.8-8.6-13.3-20.2-13.3-35v-62.5h-15.6v-27.2h15.6v-40.6h37.5v40.6h32.2v27.2h-32.2Z"/><path class="nt0" d="M637.5,304.7c0,19.6-6.7,36.2-20.1,49.6-13.4,13.4-30.2,20.1-50.5,20.1s-37.1-6.7-50.5-20.1c-13.4-13.4-20.1-30-20.1-49.6s6.7-36.2,20.1-49.7c13.4-13.5,30.2-20.3,50.5-20.3s37.1,6.8,50.5,20.3c13.4,13.5,20.1,30.1,20.1,49.7ZM533.8,304.7c0,11.1,3.1,20.1,9.3,27.1,6.2,7,14.1,10.5,23.8,10.5s17.6-3.5,23.8-10.5c6.2-7,9.3-16,9.3-27.1s-3.1-20.2-9.3-27.2-14.1-10.6-23.8-10.6-17.6,3.5-23.8,10.6-9.3,16.1-9.3,27.2Z"/><path class="nt0" d="M786.1,304.7c0,19.6-6.7,36.2-20.1,49.6-13.4,13.4-30.2,20.1-50.5,20.1s-37.1-6.7-50.5-20.1c-13.4-13.4-20.1-30-20.1-49.6s6.7-36.2,20.1-49.7c13.4-13.5,30.2-20.3,50.5-20.3s37.1,6.8,50.5,20.3c13.4,13.5,20.1,30.1,20.1,49.7ZM682.4,304.7c0,11.1,3.1,20.1,9.3,27.1,6.2,7,14.1,10.5,23.8,10.5s17.6-3.5,23.8-10.5c6.2-7,9.3-16,9.3-27.1s-3.1-20.2-9.3-27.2-14.1-10.6-23.8-10.6-17.6,3.5-23.8,10.6-9.3,16.1-9.3,27.2Z"/><path class="nt0" d="M833.5,372.4h-37.2v-186.9h37.2v186.9Z"/></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(svg);
    return;
  }

  // PWA icons (public)
  if (pathname.match(/^\/icon.*\.png$/) || pathname === '/logo.png') {
    return serveStatic(req, res);
  }

  // Login page. Public demo mode should not ask visitors for magic links.
  if (pathname === '/login') {
    if (DEMO_MODE) {
      res.writeHead(302, { Location: '/demo-login' });
      res.end();
      return;
    }
    return serveFile(res, 'login.html');
  }

  // === AUTHENTICATED ROUTES ===
  const cookies = auth.parseCookies(req.headers.cookie);
  const session = auth.validateSession(cookies.kw_session);

  // If not authenticated, redirect to login (for HTML) or 401 (for API)
  if (!session) {
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { Location: DEMO_MODE ? '/demo-login' : '/login' });
      res.end();
      return;
    }
    // Allow static assets needed by login page
    if (pathname === '/style.css' || pathname.endsWith('.png') || pathname.endsWith('.js')) {
      return serveStatic(req, res);
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // User info endpoint
  if (pathname === '/auth/me') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      kanboard_user_id: session.kanboard_user_id,
      name: session.name,
      role: session.role,
      allowed_projects: JSON.parse(session.allowed_projects),
    }));
    return;
  }

  // Logout
  if (pathname === '/auth/logout') {
    auth.revokeSession(session.id);
    auth.logActivity(session.user_id, 'logout', null);
    res.writeHead(302, {
      'Set-Cookie': auth.clearSessionCookie(),
      Location: '/login',
    });
    res.end();
    return;
  }

  // Kanboard API proxy
  if (pathname === '/api' && req.method === 'POST') {
    return handleApiProxy(req, res);
  }

  // User preferences
  if (pathname === '/prefs' && req.method === 'GET') {
    const prefs = auth.getUserPrefs(session.kanboard_user_id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prefs }));
    return;
  }

  if (pathname === '/prefs' && req.method === 'POST') {
    return readBody(req, (body) => {
      try {
        const data = JSON.parse(body);
        auth.saveUserPrefs(session.kanboard_user_id, data.prefs || data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  // Allowed projects for current user
  if (pathname === '/allowed-projects') {
    const projectIds = JSON.parse(session.allowed_projects);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectIds }));
    return;
  }

  // === ADMIN ROUTES ===
  if (pathname.startsWith('/admin')) {
    if (session.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin access required' }));
      return;
    }
    return handleAdmin(req, res, url, pathname, session);
  }

  // Serve static files (authenticated)
  serveStatic(req, res);
});

// ===== Magic Link Login =====
function handleMagicLogin(req, res, url) {
  const token = url.searchParams.get('token');
  if (!token) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Invalid link</h1><p>No token provided.</p>');
    return;
  }

  const link = auth.validateMagicLink(token);
  if (!link) {
    res.writeHead(401, { 'Content-Type': 'text/html' });
    res.end('<h1>Link expired or invalid</h1><p>Ask your admin for a new link.</p>');
    return;
  }

  // Consume the magic link
  auth.consumeMagicLink(token);

  // Create a session
  const session = auth.createSession(link.user_id, req.headers['user-agent']);

  auth.logActivity(link.user_id, 'magic_link_login', `Link: ${link.label || 'unnamed'}`);

  // Set session cookie and redirect to board
  res.writeHead(302, {
    'Set-Cookie': auth.sessionCookie(session.token),
    Location: '/',
  });
  res.end();
}

// ===== Demo Login =====
function handleDemoLogin(req, res) {
  if (!DEMO_MODE) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>Not found</h1>');
    return;
  }

  const demoUser = auth.getUsers().find(u => u.role !== 'admin' && u.is_active);
  if (!demoUser) {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end('<h1>Demo not ready</h1><p>The demo seed has not created a user yet. Try again shortly.</p>');
    return;
  }

  const session = auth.createSession(demoUser.id, req.headers['user-agent'], 1);
  auth.logActivity(demoUser.id, 'demo_login', 'Public demo login');

  res.writeHead(302, {
    'Set-Cookie': auth.sessionCookie(session.token, 1),
    Location: '/',
  });
  res.end();
}

// ===== Admin Routes =====
function handleAdmin(req, res, url, pathname, session) {
  // Admin dashboard page
  if (pathname === '/admin' && req.method === 'GET') {
    return serveFile(res, 'admin.html');
  }

  // Admin API — users
  if (pathname === '/admin/api/users' && req.method === 'GET') {
    const users = auth.getUsers();
    json(res, { users });
    return;
  }

  if (pathname === '/admin/api/users' && req.method === 'POST') {
    return readBody(req, (body) => {
      try {
        const { kanboard_user_id, name, role, allowed_projects } = JSON.parse(body);
        const id = auth.createUser(kanboard_user_id, name, role, allowed_projects);
        json(res, { id });
      } catch (e) {
        json(res, { error: e.message }, 400);
      }
    });
  }

  if (pathname.match(/^\/admin\/api\/users\/\d+$/) && req.method === 'PATCH') {
    const userId = parseInt(pathname.split('/').pop());
    return readBody(req, (body) => {
      try {
        auth.updateUser(userId, JSON.parse(body));
        json(res, { ok: true });
      } catch (e) {
        json(res, { error: e.message }, 400);
      }
    });
  }

  // Admin API — magic links
  if (pathname === '/admin/api/links' && req.method === 'GET') {
    json(res, { links: auth.getMagicLinks() });
    return;
  }

  if (pathname === '/admin/api/links' && req.method === 'POST') {
    return readBody(req, (body) => {
      try {
        const { user_id, label, expiry_days } = JSON.parse(body);
        const link = auth.createMagicLink(user_id, label, expiry_days || 30);
        json(res, { link });
      } catch (e) {
        json(res, { error: e.message }, 400);
      }
    });
  }

  if (pathname.match(/^\/admin\/api\/links\/\d+\/revoke$/) && req.method === 'POST') {
    const linkId = parseInt(pathname.split('/')[4]);
    auth.revokeMagicLink(linkId);
    json(res, { ok: true });
    return;
  }

  // Admin API — sessions
  if (pathname === '/admin/api/sessions' && req.method === 'GET') {
    json(res, { sessions: auth.getSessions() });
    return;
  }

  if (pathname.match(/^\/admin\/api\/sessions\/\d+\/revoke$/) && req.method === 'POST') {
    const sessionId = parseInt(pathname.split('/')[4]);
    auth.revokeSession(sessionId);
    json(res, { ok: true });
    return;
  }

  // Admin API — activity log
  if (pathname === '/admin/api/activity' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    json(res, { activity: auth.getActivityLog(limit) });
    return;
  }

  json(res, { error: 'Not found' }, 404);
}

// ===== Kanboard API Proxy =====
function handleApiProxy(req, res) {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    if (DEMO_MODE) {
      try {
        const payload = JSON.parse(body || '{}');
        const method = payload && payload.method;
        if (!DEMO_ALLOWED_API_METHODS.has(method)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'API method not available in public demo mode' } }));
          return;
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
        return;
      }
    }

    const url = new URL(KANBOARD_URL);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const authHeader = Buffer.from(`${KANBOARD_USER}:${KANBOARD_KEY}`).toString('base64');

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const proxy = transport.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => (data += chunk));
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });

    proxy.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }));
    });

    proxy.write(body);
    proxy.end();
  });
}

// ===== Helpers =====
function readBody(req, callback) {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => callback(body));
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveFile(res, filename) {
  const filePath = path.join(__dirname, filename);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filename);
    const contentType = MIME[ext] || 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': contentType });
    if (ext === '.html') {
      res.end(injectAnalytics(data.toString('utf8')));
    } else {
      res.end(data);
    }
  });
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (req.url !== '/favicon.ico') console.log(`404: ${req.url}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    if (ext === '.html') {
      res.end(injectAnalytics(data.toString('utf8')));
    } else {
      res.end(data);
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ${BRAND_NAME} Board running at http://0.0.0.0:${PORT}\n`);
});
