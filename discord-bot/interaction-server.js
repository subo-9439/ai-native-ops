/**
 * Discord HTTP Interaction 서버
 *
 * Cloudflare Worker → 이 서버로 Interaction payload 포워딩 → command handler 실행
 *
 * 구조:
 *   Discord → Cloudflare Worker /discord (서명 검증, type 5 DEFERRED 즉시 응답)
 *     → 본 서버 POST /interaction (Worker가 payload 포워딩)
 *       → fakeInteraction 생성 → 기존 command handler 실행
 *         → Discord webhook(interaction.token)으로 followup 전송
 *
 * 인증: Cloudflare Worker 만 접근 가능하도록 BOT_FORWARD_SECRET 헤더 검증
 */

const express = require('express');
const fetch = require('node-fetch');

function createFakeInteraction(raw) {
  const { token, application_id, data, member, user, guild_id, channel_id } = raw;
  const webhookBase = `https://discord.com/api/v10/webhooks/${application_id}/${token}`;
  const followupUrl = webhookBase;
  const originalMsgUrl = `${webhookBase}/messages/@original`;

  async function sendJson(url, method, body) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error(`[Interaction] Discord API ${method} ${url} 실패: ${res.status} ${txt}`);
      }
    } catch (err) {
      console.error(`[Interaction] Discord fetch 오류:`, err.message);
    }
  }

  const options = {
    getString: (name) => data.options?.find(o => o.name === name)?.value,
    getInteger: (name) => data.options?.find(o => o.name === name)?.value,
    getBoolean: (name) => data.options?.find(o => o.name === name)?.value,
    getUser: (name) => data.options?.find(o => o.name === name)?.value,
    getChannel: (name) => data.options?.find(o => o.name === name)?.value,
    getSubcommand: () => data.options?.[0]?.name,
    data: data.options ?? [],
  };

  const fake = {
    // 식별
    commandName: data.name,
    id: raw.id,
    token,
    applicationId: application_id,
    guildId: guild_id,
    channelId: channel_id,
    user: user || member?.user,
    member,
    options,

    // 상태 (Worker가 이미 type 5 DEFERRED 응답함)
    deferred: true,
    replied: false,
    ephemeral: false,

    // 메서드 — 모두 Discord REST webhook 호출로 변환
    deferReply: async (_opts) => { /* already deferred by Worker */ },
    reply: async (content) => {
      const body = typeof content === 'string' ? { content } : content;
      await sendJson(originalMsgUrl, 'PATCH', body);
      fake.replied = true;
    },
    editReply: async (content) => {
      const body = typeof content === 'string' ? { content } : content;
      await sendJson(originalMsgUrl, 'PATCH', body);
      fake.replied = true;
    },
    followUp: async (content) => {
      const body = typeof content === 'string' ? { content } : content;
      await sendJson(followupUrl, 'POST', body);
    },
    deleteReply: async () => {
      await sendJson(originalMsgUrl, 'DELETE');
    },
    isChatInputCommand: () => true,
    isStringSelectMenu: () => false,
    // 필요한 추가 메서드는 command 구현 시 확장
  };

  return fake;
}

/**
 * @param {object} deps
 * @param {function(string, object): Promise<void>} deps.handleCommand  (commandName, fakeInteraction) => {}
 * @param {number} deps.port
 * @param {string} [deps.forwardSecret]  Cloudflare Worker 공유 시크릿 (선택)
 */
function startInteractionServer(deps) {
  const { handleCommand, port, forwardSecret } = deps;
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 헬스체크
  app.get('/', (_req, res) => res.json({ ok: true, service: 'discord-bot-http' }));
  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // 큐 관리 API (로컬 전용)
  if (typeof deps.onQueueStart === 'function') {
    app.post('/queue/start', async (_req, res) => {
      try {
        await deps.onQueueStart();
        res.json({ ok: true, action: 'queue_start' });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }
  if (typeof deps.onQueueStatus === 'function') {
    app.get('/queue/status', (_req, res) => {
      res.json({ ok: true, summary: deps.onQueueStatus() });
    });
  }
  if (typeof deps.onQueueRaw === 'function') {
    app.get('/queue/raw', (_req, res) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.json(deps.onQueueRaw());
    });
  }

  // Cloudflare Worker → Bot Interaction 포워딩
  app.post('/interaction', async (req, res) => {
    // 선택적 인증
    if (forwardSecret) {
      const provided = req.headers['x-forward-secret'];
      if (provided !== forwardSecret) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }

    const raw = req.body;
    if (!raw || !raw.type) {
      return res.status(400).json({ error: 'invalid interaction payload' });
    }

    // Worker가 이미 DEFERRED (type 5) 응답했으므로 우리는 ACK만 즉시 반환
    res.status(200).json({ ok: true, received: raw.data?.name });

    // 비동기로 command 실행
    if (raw.type === 2 /* APPLICATION_COMMAND */) {
      const fake = createFakeInteraction(raw);
      try {
        await handleCommand(fake.commandName, fake);
      } catch (err) {
        console.error(`[Interaction] command ${fake.commandName} 오류:`, err);
        try {
          await fake.editReply(`❌ 오류: ${err.message}`);
        } catch (_) {}
      }
    }
  });

  app.listen(port, '127.0.0.1', () => {
    console.log(`[Interaction] HTTP server listening on 127.0.0.1:${port}`);
    console.log(`[Interaction] Cloudflare Tunnel이 이 포트를 외부에 노출해야 함`);
  });
}

module.exports = { startInteractionServer, createFakeInteraction };
