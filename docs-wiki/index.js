const express = require('express');
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const hljs = require('highlight.js');

const app = express();
const PORT = parseInt(process.env.WIKI_PORT || '4050', 10);
const DOCS_DIR = process.env.DOCS_DIR
  || path.join(process.env.CLAUDE_PROJECT_DIR || '', 'docs');
const OPS_DOCS_DIR = process.env.OPS_DOCS_DIR
  || path.resolve(__dirname, '..', 'docs');
// 게이트웨이 뒤에 마운트될 때 사용 (예: '/admin/wiki') — 모든 내부 링크 prefix
// X-Forwarded-Prefix 헤더가 있으면 그것을 우선 사용 (게이트웨이가 자동 주입)
const DEFAULT_BASE_PATH = (process.env.WIKI_BASE_PATH || '').replace(/\/$/, '');
function basePath(req) {
  return (req?.headers?.['x-forwarded-prefix'] || DEFAULT_BASE_PATH).replace(/\/$/, '');
}

// ─── Markdown 렌더러 ─────────────────────────────────────
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    },
  })
);

// ─── 카테고리 매핑 ───────────────────────────────────────
const CATEGORY_LABELS = {
  '.':           '프로젝트',
  'memory-bank': '🧠 Memory Bank',
  'PRD':         'PRD (기획)',
  'ARCH':        '아키텍처',
  'ai':          'AI',
  'integration': '통합/연동',
  'mockups':     '목업',
  '_ops':        '운영 도구',
};

// ─── 문서 스캔 ───────────────────────────────────────────
function scanDocs() {
  const docs = [];

  function walk(dir, rel) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'mockups') continue; // HTML 목업 제외
        walk(fullPath, relPath);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const firstLine = content.split('\n').find(l => l.trim()) || entry.name;
        const title = firstLine.replace(/^#+\s*/, '').trim();
        const stat = fs.statSync(fullPath);
        const category = rel === '.' ? '.' : rel.split(path.sep)[0];

        docs.push({
          slug: relPath.replace(/\.md$/, '').replace(/[\\/]/g, '--'),
          relPath,
          title,
          category,
          categoryLabel: CATEGORY_LABELS[category] || category,
          mtime: stat.mtime,
          content,
        });
      }
    }
  }

  walk(DOCS_DIR, '.');

  // 운영 도구 문서 (project-manager/docs/)
  if (fs.existsSync(OPS_DOCS_DIR)) {
    for (const entry of fs.readdirSync(OPS_DOCS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const fullPath = path.join(OPS_DOCS_DIR, entry.name);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const firstLine = content.split('\n').find(l => l.trim()) || entry.name;
      const title = firstLine.replace(/^#+\s*/, '').trim();
      const stat = fs.statSync(fullPath);
      docs.push({
        slug: 'ops--' + entry.name.replace(/\.md$/, ''),
        relPath: 'ops/' + entry.name,
        title,
        category: '_ops',
        categoryLabel: '운영 도구',
        mtime: stat.mtime,
        content,
        _opsDir: true,
      });
    }
  }
  return docs;
}

// ─── HTML 템플릿 ─────────────────────────────────────────
function renderPage(body, title = '문서 위키') {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — whosbuying docs</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css">
<style>
  :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #e6edf3;
          --muted: #8b949e; --accent: #58a6ff; --accent2: #3fb950; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }

  /* 사이드바 */
  .sidebar { width: 280px; background: var(--surface); border-right: 1px solid var(--border);
             padding: 20px 16px; overflow-y: auto; position: fixed; top: 0; bottom: 0; }
  .sidebar h1 { font-size: 18px; margin-bottom: 8px; }
  .sidebar h1 a { color: var(--text); text-decoration: none; }
  .sidebar .subtitle { color: var(--muted); font-size: 12px; margin-bottom: 20px; }
  .sidebar input { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border);
                   border-radius: 6px; color: var(--text); font-size: 14px; margin-bottom: 16px; outline: none; }
  .sidebar input:focus { border-color: var(--accent); }
  .cat-label { color: var(--accent2); font-size: 11px; font-weight: 600; text-transform: uppercase;
               letter-spacing: 0.5px; margin: 16px 0 6px; }
  .nav-item { display: block; padding: 6px 10px; color: var(--muted); text-decoration: none;
              font-size: 13px; border-radius: 4px; margin-bottom: 2px;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nav-item:hover { background: var(--bg); color: var(--text); }
  .nav-item.active { background: rgba(88,166,255,0.15); color: var(--accent); }
  .nav-date { color: var(--muted); font-size: 10px; float: right; margin-top: 2px; }

  /* 메인 */
  .main { margin-left: 280px; flex: 1; padding: 40px 48px; max-width: 900px; }
  .main h1 { font-size: 28px; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .meta span { margin-right: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px;
           background: rgba(63,185,80,0.15); color: var(--accent2); }

  /* 마크다운 */
  .md h1, .md h2, .md h3 { margin: 24px 0 12px; }
  .md h2 { font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .md h3 { font-size: 17px; }
  .md p { line-height: 1.7; margin-bottom: 14px; }
  .md ul, .md ol { padding-left: 24px; margin-bottom: 14px; }
  .md li { margin-bottom: 4px; line-height: 1.6; }
  .md pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
            padding: 16px; overflow-x: auto; margin-bottom: 16px; }
  .md code { font-family: 'SF Mono', Menlo, monospace; font-size: 13px; }
  .md :not(pre) > code { background: var(--surface); padding: 2px 6px; border-radius: 4px; }
  .md table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  .md th, .md td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .md th { background: var(--surface); }
  .md a { color: var(--accent); }
  .md blockquote { border-left: 3px solid var(--accent); padding: 8px 16px; margin: 12px 0;
                   color: var(--muted); background: var(--surface); border-radius: 0 6px 6px 0; }
  .md hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }

  /* 인덱스 카드 */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
          padding: 16px; text-decoration: none; color: var(--text); transition: border-color 0.2s; }
  .card:hover { border-color: var(--accent); }
  .card h3 { font-size: 14px; margin-bottom: 6px; }
  .card .card-meta { font-size: 11px; color: var(--muted); }

  /* 탭 */
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; flex-wrap: wrap; }
  .tab { padding: 6px 14px; border-radius: 16px; font-size: 13px; cursor: pointer;
         background: var(--surface); border: 1px solid var(--border); color: var(--muted); text-decoration: none; }
  .tab:hover, .tab.active { background: rgba(88,166,255,0.15); color: var(--accent); border-color: var(--accent); }

  @media (max-width: 768px) {
    .sidebar { position: static; width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
    .main { margin-left: 0; padding: 20px; }
    body { flex-direction: column; }
  }
</style>
</head>
<body>
${body}
<script>
document.querySelector('.sidebar input')?.addEventListener('input', function(e) {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.nav-item').forEach(a => {
    a.style.display = a.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.card').forEach(c => {
    c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});
</script>
</body>
</html>`;
}

function buildSidebar(docs, activeSlug, base = '') {
  const grouped = {};
  for (const d of docs) {
    if (!grouped[d.categoryLabel]) grouped[d.categoryLabel] = [];
    grouped[d.categoryLabel].push(d);
  }

  let html = `<div class="sidebar">
  <h1><a href="${base}/">whosbuying</a></h1>
  <div class="subtitle">프로젝트 문서 위키 — ${docs.length}개 문서</div>
  <input type="text" placeholder="검색..." />`;

  for (const [cat, items] of Object.entries(grouped)) {
    html += `<div class="cat-label">${cat}</div>`;
    for (const d of items.sort((a, b) => b.mtime - a.mtime)) {
      const active = d.slug === activeSlug ? ' active' : '';
      const date = d.mtime.toISOString().slice(5, 10).replace('-', '/');
      html += `<a class="nav-item${active}" href="${base}/doc/${d.slug}" title="${d.title}">
        ${d.title}<span class="nav-date">${date}</span></a>`;
    }
  }

  html += `</div>`;
  return html;
}

// ─── 라우트 ──────────────────────────────────────────────

// 인덱스
app.get('/', (req, res) => {
  const base = basePath(req);
  const docs = scanDocs();
  const cat = req.query.cat || 'all';
  const sort = req.query.sort || 'date';
  const filtered = cat === 'all' ? docs : docs.filter(d => d.categoryLabel === cat || d.category === cat);
  const sorted = [...filtered].sort((a, b) =>
    sort === 'name' ? a.title.localeCompare(b.title) : b.mtime - a.mtime
  );

  const categories = ['all', ...new Set(docs.map(d => d.categoryLabel))];
  const tabs = categories.map(c =>
    `<a class="tab${c === cat ? ' active' : ''}" href="${base}/?cat=${encodeURIComponent(c)}&sort=${sort}">${c === 'all' ? '전체' : c}</a>`
  ).join('');
  const sortTabs = `<a class="tab${sort === 'date' ? ' active' : ''}" href="${base}/?cat=${cat}&sort=date">최신순</a>
    <a class="tab${sort === 'name' ? ' active' : ''}" href="${base}/?cat=${cat}&sort=name">이름순</a>`;

  const cards = sorted.map(d => {
    const date = d.mtime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    return `<a class="card" href="${base}/doc/${d.slug}">
      <h3>${d.title}</h3>
      <div class="card-meta"><span class="badge">${d.categoryLabel}</span> ${date}</div>
    </a>`;
  }).join('');

  const body = `${buildSidebar(docs, null, base)}
  <div class="main">
    <h1>문서 위키</h1>
    <div class="meta"><span>${docs.length}개 문서</span></div>
    <div class="tabs">${tabs}</div>
    <div class="tabs">${sortTabs}</div>
    <div class="cards">${cards}</div>
  </div>`;

  res.send(renderPage(body));
});

// 문서 상세
app.get('/doc/:slug', (req, res) => {
  const base = basePath(req);
  const docs = scanDocs();
  const doc = docs.find(d => d.slug === req.params.slug);
  if (!doc) return res.status(404).send(renderPage(`${buildSidebar(docs, null, base)}<div class="main"><h1>404</h1><p>문서를 찾을 수 없습니다.</p></div>`, '404'));

  const html = marked.parse(doc.content);
  const date = doc.mtime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const body = `${buildSidebar(docs, doc.slug, base)}
  <div class="main">
    <h1>${doc.title}</h1>
    <div class="meta">
      <span class="badge">${doc.categoryLabel}</span>
      <span>${date} 수정</span>
      <span>${doc.relPath}</span>
    </div>
    <div class="md">${html}</div>
  </div>`;

  res.send(renderPage(body, doc.title));
});

// API — 디스코드 봇 연동용
app.get('/api/docs', (req, res) => {
  const docs = scanDocs();
  const cat = req.query.cat;
  const filtered = cat ? docs.filter(d => d.categoryLabel === cat || d.category === cat) : docs;
  res.json(filtered.map(d => ({
    slug: d.slug,
    title: d.title,
    category: d.categoryLabel,
    path: d.relPath,
    mtime: d.mtime.toISOString(),
  })));
});

app.get('/api/docs/:slug', (req, res) => {
  const docs = scanDocs();
  const doc = docs.find(d => d.slug === req.params.slug);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({
    slug: doc.slug,
    title: doc.title,
    category: doc.categoryLabel,
    path: doc.relPath,
    mtime: doc.mtime.toISOString(),
    content: doc.content,
  });
});

app.get('/health', (req, res) => res.json({ ok: true, docs: DOCS_DIR, uptime: process.uptime() }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Wiki] http://127.0.0.1:${PORT}`);
  console.log(`[Wiki] docs: ${DOCS_DIR}`);
});
