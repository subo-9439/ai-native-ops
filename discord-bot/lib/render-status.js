// Render API 클라이언트 — 최근 디플로이 상태 조회.
// RENDER_API_KEY + RENDER_SERVICE_ID 환경변수 미설정 시 'unknown' 으로 degraded.
// 자가진단(health-check.js)이 사람 개입 없이 "코드는 푸시됐는데 라이브 반영이 안 됨"을 잡기 위함.

async function loadFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

async function fetchLatestDeploy({ apiKey, serviceId, timeoutMs = 5_000 } = {}) {
  apiKey = apiKey || process.env.RENDER_API_KEY;
  serviceId = serviceId || process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    return { status: 'unknown', reason: 'RENDER_API_KEY/SERVICE_ID 미설정 (degraded)' };
  }

  const f = await loadFetch();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(
      `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=1`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      return { status: 'error', reason: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const item = Array.isArray(data) && data[0]?.deploy ? data[0].deploy : null;
    if (!item) return { status: 'empty', reason: 'no deploys returned' };
    return {
      status: item.status,
      commit: (item.commit?.id || '').slice(0, 7) || 'unknown',
      finishedAt: item.finishedAt || null,
      createdAt: item.createdAt || null,
    };
  } catch (err) {
    return { status: 'error', reason: err.name === 'AbortError' ? `timeout ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchLatestDeploy };
