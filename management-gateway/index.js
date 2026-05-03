/**
 * 운영 관리 게이트웨이
 *
 * 구조:
 *   사용자 브라우저 → 이 게이트웨이(:4000) → 내부 서비스들
 *
 * 엔드포인트:
 *   GET  /                    → /admin/wiki 로 리다이렉트
 *   GET  /admin/login         로그인 페이지
 *   POST /admin/login         인증 처리 → 세션 쿠키 발급
 *   GET  /admin/logout        로그아웃
 *   GET  /admin/wiki/*        위키 프록시 (인증 필요)
 *   POST /auth/sso            Discord 봇 전용, SSO 토큰 발급 (로컬 호출만)
 *   GET  /admin/sso?token=... SSO 토큰으로 즉시 로그인
 *
 * 인증 방식:
 *   1. 아이디/비밀번호 → 세션 쿠키 (브라우저 직접)
 *   2. SSO 토큰 (Discord 봇이 발급, 5분 일회용) → 세션으로 교환
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();

// ─── 설정 ────────────────────────────────────────────────
const PORT = parseInt(process.env.GATEWAY_PORT || '4000', 10);
const WIKI_INTERNAL_URL = process.env.WIKI_INTERNAL_URL || 'http://127.0.0.1:4050';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const CREDENTIALS_FILE = process.env.ADMIN_CREDENTIALS_FILE
  || path.resolve(__dirname, '..', '.admin-credentials.json');
const SSO_SHARED_SECRET = process.env.GATEWAY_SSO_SECRET || '';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간
const SSO_TTL_MS     = 5  * 60 * 1000;      // 5분

// ─── 메모리 세션/SSO 저장소 ──────────────────────────────
const sessions = new Map();  // sessionId → { username, createdAt }
const ssoTokens = new Map(); // token → { expiresAt, used: bool }

// ─── 자격 증명 로드 ──────────────────────────────────────
function loadCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      console.warn(`[Gateway] credentials 파일 없음: ${CREDENTIALS_FILE}`);
      return null;
    }
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch (err) {
    console.error('[Gateway] credentials 읽기 실패:', err.message);
    return null;
  }
}

function verifyCredentials(username, password) {
  const creds = loadCredentials();
  if (!creds) return false;
  if (creds.username !== username) return false;
  // 우선 bcrypt 해시 검증, 없으면 평문(레거시)로 fallback
  if (typeof creds.passwordHash === 'string' && creds.passwordHash.length > 0) {
    try {
      return bcrypt.compareSync(password, creds.passwordHash);
    } catch {
      return false;
    }
  }
  if (typeof creds.password === 'string' && creds.password.length > 0) {
    console.warn('[Gateway] ⚠️  평문 비밀번호 사용 중 — passwordHash 로 마이그레이션 권장');
    return creds.password === password;
  }
  return false;
}

// ─── 세션 유틸 ───────────────────────────────────────────
function createSession(username) {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { username, createdAt: Date.now() });
  return id;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

// 주기적 정리
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
  for (const [t, meta] of ssoTokens) {
    if (now > meta.expiresAt) ssoTokens.delete(t);
  }
}, 60 * 1000);

// ─── 미들웨어 ────────────────────────────────────────────
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function requireAuth(req, res, next) {
  const session = getSession(req.cookies?.admin_session);
  if (!session) {
    const next_url = encodeURIComponent(req.originalUrl);
    return res.redirect(`/admin/login?next=${next_url}`);
  }
  req.session = session;
  next();
}

// ─── 페이지 템플릿 ───────────────────────────────────────
function loginPage({ error = '', next_url = '/admin/wiki' } = {}) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>운영 관리 로그인</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif;
         background: #0d1117; color: #e6edf3;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; }
  .box { background: #161b22; border: 1px solid #30363d; border-radius: 12px;
         padding: 32px; width: 320px; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  .sub { color: #8b949e; font-size: 13px; margin-bottom: 20px; }
  label { display: block; margin-top: 14px; font-size: 12px; color: #8b949e; }
  input { width: 100%; padding: 10px 12px; background: #0d1117;
          border: 1px solid #30363d; border-radius: 6px; color: #e6edf3;
          font-size: 14px; margin-top: 4px; box-sizing: border-box; }
  input:focus { outline: none; border-color: #58a6ff; }
  button { width: 100%; margin-top: 20px; padding: 10px; background: #238636;
           border: none; border-radius: 6px; color: white; font-size: 14px;
           font-weight: 600; cursor: pointer; }
  button:hover { background: #2ea043; }
  .err { color: #f85149; font-size: 12px; margin-top: 12px; }
  .hint { color: #6e7681; font-size: 11px; margin-top: 16px; text-align: center; }
</style>
</head>
<body>
<form class="box" method="POST" action="/admin/login">
  <h1>🔒 운영 관리 로그인</h1>
  <div class="sub">whosbuying ops gateway</div>
  <input type="hidden" name="next" value="${next_url}">
  <label>아이디</label>
  <input name="username" autocomplete="username" autofocus required>
  <label>비밀번호</label>
  <input name="password" type="password" autocomplete="current-password" required>
  <button type="submit">로그인</button>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div class="hint">Discord 봇 /docs 명령으로 자동 로그인 링크 받기</div>
</form>
</body>
</html>`;
}

// ─── 라우트 ──────────────────────────────────────────────

// 루트 → wiki로
app.get('/', (req, res) => res.redirect('/admin/wiki'));

// 로그인 페이지
app.get('/admin/login', (req, res) => {
  const next_url = req.query.next || '/admin/wiki';
  res.send(loginPage({ next_url }));
});

// 로그인 처리
app.post('/admin/login', (req, res) => {
  const { username, password, next: nextUrl } = req.body || {};
  if (!verifyCredentials(username, password)) {
    return res.status(401).send(loginPage({
      error: '❌ 아이디 또는 비밀번호가 틀립니다',
      next_url: nextUrl || '/admin/wiki',
    }));
  }
  const sessionId = createSession(username);
  res.cookie('admin_session', sessionId, {
    httpOnly: true, sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
  res.redirect(nextUrl || '/admin/wiki');
});

// 로그아웃
app.get('/admin/logout', (req, res) => {
  if (req.cookies?.admin_session) sessions.delete(req.cookies.admin_session);
  res.clearCookie('admin_session');
  res.redirect('/admin/login');
});

// SSO 토큰 발급 (Discord 봇 전용 — 로컬 호출만)
app.post('/auth/sso', (req, res) => {
  // 봇과 공유 시크릿 검증 (있을 때만)
  if (SSO_SHARED_SECRET) {
    const provided = req.headers['x-sso-secret'];
    if (provided !== SSO_SHARED_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  const target = req.body?.target || '/admin/wiki';
  const token = crypto.randomBytes(24).toString('hex');
  ssoTokens.set(token, {
    expiresAt: Date.now() + SSO_TTL_MS,
    used: false,
    target,
  });
  const url = `${PUBLIC_BASE_URL}/admin/sso?token=${token}`;
  res.json({ url, token, expiresIn: SSO_TTL_MS / 1000 });
});

// SSO 토큰 → 세션 교환
app.get('/admin/sso', (req, res) => {
  const token = req.query?.token;
  const meta = ssoTokens.get(token);
  if (!meta || meta.used || Date.now() > meta.expiresAt) {
    return res.status(401).send(loginPage({
      error: '❌ 만료되거나 유효하지 않은 SSO 링크입니다. 다시 시도하세요.',
    }));
  }
  meta.used = true;
  ssoTokens.delete(token);

  const sessionId = createSession('admin-sso');
  res.cookie('admin_session', sessionId, {
    httpOnly: true, sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
  res.redirect(meta.target || '/admin/wiki');
});

// ─── 위키 프록시 (인증 필요) ─────────────────────────────
// /admin/wiki → 내부 위키 / (pathRewrite)
app.use(
  '/admin/wiki',
  requireAuth,
  createProxyMiddleware({
    target: WIKI_INTERNAL_URL,
    changeOrigin: true,
    pathRewrite: { '^/admin/wiki': '' },
    // 위키가 모든 내부 링크에 prefix를 붙이도록 헤더 전달
    // → 위키 코드가 X-Forwarded-Prefix 헤더를 읽어서 href에 prepend
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('X-Forwarded-Prefix', '/admin/wiki');
      },
    },
    selfHandleResponse: false,
  })
);

// ─── 큐 대시보드 (인증 불필요 — 실시간 모니터링용) ─────────
const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:4040';

app.get('/queue', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>큐 대시보드 — whosbuying ops</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,system-ui,'Segoe UI',sans-serif; background:#0d1117; color:#e6edf3; min-height:100vh; padding:24px; }
  .header { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
  .header h1 { font-size:20px; font-weight:600; }
  .header .live { width:8px; height:8px; border-radius:50%; background:#3fb950; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .stats { display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap; }
  .stat { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px 20px; min-width:120px; }
  .stat .num { font-size:28px; font-weight:700; }
  .stat .label { font-size:12px; color:#8b949e; margin-top:4px; }
  .stat.active .num { color:#58a6ff; }
  .stat.done .num { color:#3fb950; }
  .stat.pending .num { color:#d29922; }
  .stat.failed .num { color:#f85149; }
  .progress-bar { background:#21262d; border-radius:8px; height:8px; margin-bottom:24px; overflow:hidden; }
  .progress-fill { height:100%; background:linear-gradient(90deg,#3fb950,#58a6ff); transition:width .5s ease; border-radius:8px; }
  .items { display:flex; flex-direction:column; gap:8px; }
  .item { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; display:flex; align-items:center; gap:12px; transition:border-color .3s; }
  .item.in_progress { border-color:#58a6ff; background:#161b2a; }
  .item.done { opacity:.7; }
  .item.failed { border-color:#f85149; }
  .icon { font-size:20px; flex-shrink:0; }
  .info { flex:1; }
  .info .id { font-weight:600; font-size:14px; }
  .info .title { color:#8b949e; font-size:13px; margin-top:2px; }
  .agent { font-size:11px; padding:3px 8px; border-radius:4px; background:#21262d; color:#8b949e; flex-shrink:0; }
  .time { font-size:11px; color:#6e7681; flex-shrink:0; }
  .empty { text-align:center; padding:60px; color:#6e7681; }
  .refresh { font-size:11px; color:#6e7681; text-align:center; margin-top:16px; }
</style>
</head>
<body>
<div class="header">
  <div class="live"></div>
  <h1>큐 대시보드</h1>
</div>
<div class="stats" id="stats"></div>
<div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
<div class="items" id="items"></div>
<div class="refresh" id="refresh"></div>
<script>
const BOT_URL = '/queue/data';
const ICONS = { done:'✅', in_progress:'⏳', pending:'⏸️', failed:'❌' };
const AGENT_LABELS = { 'backend-dev':'🔧 BE', 'frontend-dev':'🎨 FE', 'ai-dev':'🤖 AI' };

function elapsed(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms/60000);
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  return Math.floor(m/60) + '시간 ' + (m%60) + '분 전';
}

function duration(start, end) {
  if (!start) return '';
  const ms = (end ? new Date(end) : new Date()) - new Date(start);
  const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000);
  return m > 0 ? m + '분 ' + s + '초' : s + '초';
}

async function refresh() {
  try {
    const res = await fetch(BOT_URL);
    const data = await res.json();
    const items = data.items || [];
    const done = items.filter(i=>i.status==='done').length;
    const active = items.filter(i=>i.status==='in_progress').length;
    const pending = items.filter(i=>i.status==='pending').length;
    const failed = items.filter(i=>i.status==='failed').length;
    const total = items.length;

    document.getElementById('stats').innerHTML =
      '<div class="stat done"><div class="num">'+done+'</div><div class="label">완료</div></div>' +
      '<div class="stat active"><div class="num">'+active+'</div><div class="label">진행 중</div></div>' +
      '<div class="stat pending"><div class="num">'+pending+'</div><div class="label">대기</div></div>' +
      (failed?'<div class="stat failed"><div class="num">'+failed+'</div><div class="label">실패</div></div>':'') +
      '<div class="stat"><div class="num">'+total+'</div><div class="label">전체</div></div>';

    document.getElementById('progress').style.width = total ? ((done/total)*100)+'%' : '0%';

    if (!total) {
      document.getElementById('items').innerHTML = '<div class="empty">큐가 비어있습니다</div>';
    } else {
      document.getElementById('items').innerHTML = items.map(i =>
        '<div class="item '+i.status+'">' +
        '<div class="icon">'+ICONS[i.status]+'</div>' +
        '<div class="info"><div class="id">'+i.id+'</div><div class="title">'+i.title+'</div></div>' +
        '<div class="agent">'+(AGENT_LABELS[i.agent]||i.agent)+'</div>' +
        '<div class="time">'+(i.status==='in_progress'?duration(i.startedAt):i.status==='done'?duration(i.startedAt,i.completedAt):'' )+'</div>' +
        '</div>'
      ).join('');
    }

    document.getElementById('refresh').textContent = '마지막 갱신: ' + new Date().toLocaleTimeString('ko');
  } catch(e) {
    document.getElementById('refresh').textContent = '연결 실패 — 봇이 꺼져있을 수 있습니다';
  }
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`);
});

// 큐 데이터 프록시 (봇 → 게이트웨이)
app.get('/queue/data', async (req, res) => {
  try {
    const response = await fetch(BOT_INTERNAL_URL + '/queue/raw');
    const data = await response.json();
    res.header('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    res.status(502).json({ items: [], error: 'bot unreachable' });
  }
});

// ─── 헬스체크 ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    sessions: sessions.size,
    ssoTokensActive: ssoTokens.size,
    credentialsLoaded: !!loadCredentials(),
  });
});

app.listen(PORT, () => {
  console.log(`[Gateway] 관리 게이트웨이 시작: ${PUBLIC_BASE_URL}`);
  console.log(`[Gateway] 위키 프록시 → ${WIKI_INTERNAL_URL}`);
  console.log(`[Gateway] credentials: ${CREDENTIALS_FILE}`);
  if (!loadCredentials()) {
    console.warn(`[Gateway] ⚠️  credentials 파일이 없습니다. 로그인 불가.`);
  }
});
