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
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css">
<style>
  :root { --bg: #ffffff; --surface: #f6f8fa; --surface-2: #eff2f5; --border: #d0d7de; --text: #1f2328;
          --muted: #656d76; --accent: #0969da; --accent2: #1a7f37;
          --sidebar-bg: #f6f8fa; --read-bg: #ffffff; --read-text: #24292f; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
         background: var(--bg); color: var(--text); display: flex; min-height: 100vh;
         -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

  /* 사이드바 */
  .sidebar { width: 280px; background: var(--sidebar-bg); border-right: 1px solid var(--border);
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
  .nav-item:hover { background: var(--surface-2); color: var(--text); }
  .nav-item.active { background: rgba(9,105,218,0.12); color: var(--accent); font-weight: 600; }
  .nav-date { color: var(--muted); font-size: 10px; float: right; margin-top: 2px; }

  /* 메인 */
  .main { margin-left: 280px; flex: 1; padding: 48px 56px 80px; max-width: 920px;
          background: var(--read-bg); color: var(--read-text); }
  .main h1 { font-size: 30px; margin-bottom: 10px; border-bottom: 1px solid var(--border);
             padding-bottom: 14px; letter-spacing: -0.01em; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 28px; }
  .meta span { margin-right: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px;
           background: rgba(26,127,55,0.12); color: var(--accent2); font-weight: 600; }

  /* 마크다운 — 읽기 우선 (16px / line-height 1.8) */
  .md { font-size: 16px; color: var(--read-text); }
  .md h1, .md h2, .md h3 { margin: 32px 0 14px; color: #0f172a; letter-spacing: -0.01em; }
  .md h2 { font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .md h3 { font-size: 18px; }
  .md p { line-height: 1.8; margin-bottom: 16px; color: var(--read-text); }
  .md ul, .md ol { padding-left: 26px; margin-bottom: 16px; }
  .md li { margin-bottom: 6px; line-height: 1.75; }
  .md strong { color: #0f172a; font-weight: 700; }
  .md pre { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
            padding: 16px; overflow-x: auto; margin-bottom: 18px; font-size: 13.5px; line-height: 1.6; }
  .md code { font-family: 'SF Mono', Menlo, 'Consolas', monospace; font-size: 13.5px; }
  .md :not(pre) > code { background: var(--surface); padding: 2px 6px; border-radius: 4px;
                         color: #cf222e; border: 1px solid rgba(208,215,222,0.6); }
  .md table { border-collapse: collapse; width: 100%; margin-bottom: 18px; font-size: 14px; }
  .md th, .md td { border: 1px solid var(--border); padding: 10px 14px; text-align: left; line-height: 1.6; }
  .md th { background: var(--surface); font-weight: 700; }
  .md tr:nth-child(even) td { background: #fafbfc; }
  .md a { color: var(--accent); text-decoration: none; border-bottom: 1px solid rgba(9,105,218,0.25); }
  .md a:hover { border-bottom-color: var(--accent); }
  .md blockquote { border-left: 4px solid var(--accent); padding: 10px 18px; margin: 16px 0;
                   color: #475569; background: var(--surface); border-radius: 0 8px 8px 0; }
  .md hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
  .md img { max-width: 100%; border-radius: 6px; }

  /* 인덱스 카드 */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
          padding: 16px; text-decoration: none; color: var(--text); transition: border-color 0.2s; }
  .card:hover { border-color: var(--accent); }
  .card h3 { font-size: 14px; margin-bottom: 6px; }
  .card .card-meta { font-size: 11px; color: var(--muted); }

  /* 달력 */
  .month-count { display: inline-block; margin-left: 8px; padding: 2px 8px;
                 font-size: 11px; background: var(--surface); border-radius: 10px;
                 color: var(--accent); font-weight: normal; vertical-align: middle; }
  .calendar { margin-top: 24px; }
  .cal-header { display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 16px; gap: 12px; }
  .cal-title { font-size: 20px; margin: 0; flex: 1; text-align: center; }
  .cal-nav { padding: 6px 14px; background: var(--surface); border: 1px solid var(--border);
             border-radius: 6px; color: var(--text); text-decoration: none; font-size: 13px; }
  .cal-nav:hover:not(.disabled) { border-color: var(--accent); color: var(--accent); }
  .cal-nav.disabled { color: var(--muted); opacity: 0.4; cursor: default; }
  .cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
                  margin-bottom: 4px; }
  .cal-weekday { padding: 8px; text-align: center; font-size: 12px;
                 color: var(--muted); font-weight: 600;
                 background: var(--surface); border-radius: 6px; }
  .cal-weekday.sun { color: #f85149; }
  .cal-weekday.sat { color: #58a6ff; }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .cal-cell { min-height: 100px; background: var(--surface); border: 1px solid var(--border);
              border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 3px;
              overflow: hidden; }
  .cal-cell.empty { background: transparent; border: 1px dashed var(--border); opacity: 0.3; }
  .cal-cell.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .cal-day { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 2px; }
  .cal-cell.sun .cal-day { color: #f85149; }
  .cal-cell.sat .cal-day { color: #58a6ff; }
  .cal-doc { display: block; padding: 4px 6px; background: #ffffff;
             border-radius: 4px; font-size: 11px; color: var(--text);
             text-decoration: none; white-space: nowrap; overflow: hidden;
             text-overflow: ellipsis; border-left: 2px solid var(--accent); border: 1px solid var(--border); border-left-width: 2px; }
  .cal-doc:hover { background: rgba(9,105,218,0.08); }
  .cal-doc-cat { display: block; color: var(--muted); font-size: 9px;
                 text-transform: uppercase; margin-bottom: 1px; }

  /* 탭 */
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; flex-wrap: wrap; }
  .tab { padding: 6px 14px; border-radius: 16px; font-size: 13px; cursor: pointer;
         background: var(--surface); border: 1px solid var(--border); color: var(--muted); text-decoration: none; }
  .tab:hover, .tab.active { background: rgba(9,105,218,0.12); color: var(--accent); border-color: var(--accent); }

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
// marked 가 mermaid 코드블록을 pre code.language-mermaid 로 렌더링 → mermaid.run 이 먹게 pre.mermaid 로 변환
document.querySelectorAll('pre code.language-mermaid').forEach(el => {
  const pre = el.parentElement;
  pre.className = 'mermaid';
  pre.textContent = el.textContent;
});
</script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
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
    <a class="tab${sort === 'name' ? ' active' : ''}" href="${base}/?cat=${cat}&sort=name">이름순</a>
    <a class="tab${sort === 'month' ? ' active' : ''}" href="${base}/?cat=${cat}&sort=month">월별</a>`;

  const card = (d) => {
    const date = d.mtime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    return `<a class="card" href="${base}/doc/${d.slug}">
      <h3>${d.title}</h3>
      <div class="card-meta"><span class="badge">${d.categoryLabel}</span> ${date}</div>
    </a>`;
  };

  // 월별 달력 뷰 (기본: 가장 최근 문서가 있는 월)
  let content;
  if (sort === 'month') {
    // 문서가 존재하는 모든 YYYY-MM 수집
    const monthsWithDocs = new Set();
    for (const d of filtered) {
      monthsWithDocs.add(`${d.mtime.getFullYear()}-${String(d.mtime.getMonth() + 1).padStart(2, '0')}`);
    }
    const allMonths = [...monthsWithDocs].sort((a, b) => b.localeCompare(a));

    // 선택된 월 (쿼리 파라미터 ym 또는 최신)
    const selectedYm = req.query.ym || allMonths[0] || (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    })();
    const [selY, selM] = selectedYm.split('-').map(Number);

    // 해당 월의 날짜별 문서 그룹핑
    const byDate = new Map(); // day(1~31) → docs[]
    for (const d of filtered) {
      if (d.mtime.getFullYear() === selY && d.mtime.getMonth() + 1 === selM) {
        const day = d.mtime.getDate();
        if (!byDate.has(day)) byDate.set(day, []);
        byDate.get(day).push(d);
      }
    }

    // 달력 그리드 계산
    const firstDay = new Date(selY, selM - 1, 1).getDay(); // 0=일요일
    const daysInMonth = new Date(selY, selM, 0).getDate();
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

    const today = new Date();
    const isToday = (day) =>
      today.getFullYear() === selY && today.getMonth() + 1 === selM && today.getDate() === day;

    // 이전/다음 월 네비 (문서 있는 월만 이동)
    const currentIdx = allMonths.indexOf(selectedYm);
    const prevYm = currentIdx >= 0 && currentIdx < allMonths.length - 1 ? allMonths[currentIdx + 1] : null;
    const nextYm = currentIdx > 0 ? allMonths[currentIdx - 1] : null;
    const navLink = (ym, label) => ym
      ? `<a class="cal-nav" href="${base}/?cat=${cat}&sort=month&ym=${ym}">${label}</a>`
      : `<span class="cal-nav disabled">${label}</span>`;

    // 셀 렌더링
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const headerRow = weekdays.map((w, i) =>
      `<div class="cal-weekday${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`
    ).join('');

    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const day = i - firstDay + 1;
      if (day < 1 || day > daysInMonth) {
        cells.push(`<div class="cal-cell empty"></div>`);
      } else {
        const dayDocs = byDate.get(day) || [];
        const dowClass = i % 7 === 0 ? ' sun' : i % 7 === 6 ? ' sat' : '';
        const todayClass = isToday(day) ? ' today' : '';
        const docsHtml = dayDocs.map(d =>
          `<a class="cal-doc" href="${base}/doc/${d.slug}" title="${d.title}">
            <span class="cal-doc-cat">${d.categoryLabel}</span>${d.title}
          </a>`
        ).join('');
        cells.push(`<div class="cal-cell${dowClass}${todayClass}">
          <div class="cal-day">${day}</div>
          ${docsHtml}
        </div>`);
      }
    }

    const monthTotal = [...byDate.values()].reduce((sum, arr) => sum + arr.length, 0);

    content = `<div class="calendar">
      <div class="cal-header">
        ${navLink(prevYm, '← 이전 월')}
        <h2 class="cal-title">${selY}년 ${selM}월 <span class="month-count">${monthTotal}개</span></h2>
        ${navLink(nextYm, '다음 월 →')}
      </div>
      <div class="cal-weekdays">${headerRow}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>`;
  } else {
    content = `<div class="cards">${sorted.map(card).join('')}</div>`;
  }

  const body = `${buildSidebar(docs, null, base)}
  <div class="main">
    <h1>문서 위키</h1>
    <div class="meta"><span>${docs.length}개 문서</span></div>
    <div class="tabs">${tabs}</div>
    <div class="tabs">${sortTabs}</div>
    ${content}
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
