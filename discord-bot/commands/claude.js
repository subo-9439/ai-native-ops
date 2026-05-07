const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { buildFullPrompt, writeOpsLog, extractSummary, extractChangedFiles } = require('../context-manager');
const { appendChangelog } = require('../changelog-manager');
const { validateUserMessage } = require('../pre-tool-gate');
const { loadQueue, queueSummary: getQueueSummary } = require('../work-queue');
const { recordDiscordEvent, readRecentContext } = require('../sync-writer');
// PR-OOP2: 채널/역할 메타 SSOT — agent-config.js
const {
  CHANNEL_LABELS,
  CHANNEL_COLORS,
  getSyncAgent,
} = require('../agent-config');

// channelName → claude-sync agent (ceo|dev|be|fe|ai|user)
// agent-config.js 의 SSOT 를 우회하지 않도록 thin wrapper.
const toSyncAgent = getSyncAgent;

const MAX_LEN = 1900;
const STREAM_INTERVAL_MS = 4000;

// ─── 채널별 모델 설정 로더 ───────────────────────────────
const CHANNEL_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'channel-config.json');

/**
 * 채널/역할에 맞는 모델 반환. 파일을 매번 읽어서 재시작 없이 변경 반영.
 * 파일 없거나 파싱 실패 시 → null (Claude CLI 기본값 사용)
 */
function getModelForRole(role) {
  try {
    if (!fs.existsSync(CHANNEL_CONFIG_PATH)) return null;
    const cfg = JSON.parse(fs.readFileSync(CHANNEL_CONFIG_PATH, 'utf-8'));
    const roleCfg = cfg.roles?.[role];
    return roleCfg?.model || cfg.defaults?.model || null;
  } catch (err) {
    console.error('[Model] channel-config 읽기 실패:', err.message);
    return null;
  }
}

/** Claude CLI args 배열 생성 (모델 플래그 포함) */
function buildClaudeArgs(role, opts = {}) {
  const args = ['--print', '--dangerously-skip-permissions'];
  const model = getModelForRole(role);
  if (model) args.push('--model', model);
  // PR-PLAN1: plan 모드 — 코드 변경 도구 차단, 읽기 전용만 허용.
  // Edit/Write/NotebookEdit 미허용 + Bash 는 read-only 패턴만.
  if (opts.plan) {
    args.push(
      '--allowedTools',
      'Read,Glob,Grep,WebFetch,WebSearch,Bash(git diff:*),Bash(git log:*),Bash(git status:*),Bash(ls:*),Bash(find:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(rg:*),Bash(grep:*)'
    );
  }
  return args;
}

/**
 * PR-PLAN1: Plan 모드 system prompt — 코드/파일 변경 금지, 양식 강제.
 * /plan 슬래시 + dispatch 앞 plan-check 양쪽에서 재사용.
 */
// PR-ROLE2 — 페르소나 SSOT 외부화. 이전: claude.js inline 250+ 줄.
// 현재: prompts/*.md 7개 파일이 SSOT. CLI / Discord 봇 / Bridge MCP / 디스패치 분기 4 경로 동일 적용.
// 페르소나 자체 수정은 prompts/ 디렉토리에서. 본 파일은 require + AGENT_CONTEXTS 매핑만.
function loadPrompt(name) {
  return fs.readFileSync(
    path.join(__dirname, '..', 'prompts', `${name}.md`),
    'utf8',
  );
}

const PLAN_CONTEXT = loadPrompt('plan');


/**
 * 통합 개발 에이전트 컨텍스트 — 모든 dev 작업이 동일 base 사용.
 * 디스패치 섹션(BE/FE/AI)은 [작업 지시] placeholder 를 각 delta 로 대체.
 * 페르소나 자체 수정은 prompts/dev.md 에서.
 */
const DEV_CONTEXT = loadPrompt('dev');
const _BE_DELTA = loadPrompt('backend-dev-delta');
const _FE_DELTA = loadPrompt('frontend-dev-delta');
const _AI_DELTA = loadPrompt('ai-dev-delta');

// PR-ROLE2 — base + delta 패턴 유지. dev base 의 [작업 지시] placeholder 를 각 delta 로 대체.
// 페르소나 자체 수정은 prompts/*.md. 본 매핑만 claude.js 가 소유.
const AGENT_CONTEXTS = {
  'dev': DEV_CONTEXT,
  '잡담': DEV_CONTEXT,
  'backend-dev': DEV_CONTEXT.replace('[작업 지시]', _BE_DELTA),
  'frontend-dev': DEV_CONTEXT.replace('[작업 지시]', _FE_DELTA),
  'ai-dev': DEV_CONTEXT.replace('[작업 지시]', _AI_DELTA),
  'ceo': loadPrompt('ceo'),
  'design-director': loadPrompt('design-director'),
};


// PR-OOP2: CHANNEL_LABELS, CHANNEL_COLORS 정의 → agent-config.js SSOT 로 이관.
// 본 파일은 그대로 import 해서 사용한다.

/**
 * 기획실 지시문을 섹션별로 파싱
 * ---BE---, ---FE---, ---AI---, ---ALL--- 구분자 지원
 *
 * 반환 예시:
 *   { all: null, be: '서버 API 추가', fe: '버튼 UI 추가', ai: null }
 *
 * 구분자 없으면: { all: '전체 지시문', be: null, fe: null, ai: null }
 */
function parseDispatchSections(content) {
  const result = { all: null, be: null, fe: null, ai: null };

  // ---TAG--- 패턴으로 분리
  const sectionRegex = /---\s*(ALL|BE|FE|AI)\s*---/gi;
  const parts = content.split(sectionRegex);

  if (parts.length === 1) {
    // 구분자 없음 → 전체를 all로
    result.all = content.trim();
    return result;
  }

  // parts = [before, TAG1, body1, TAG2, body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i].toUpperCase();
    const body = (parts[i + 1] || '').trim();
    if (!body) continue;
    if (tag === 'ALL') result.all = body;
    if (tag === 'BE')  result.be  = body;
    if (tag === 'FE')  result.fe  = body;
    if (tag === 'AI')  result.ai  = body;
  }

  return result;
}

/**
 * 파싱된 섹션에서 실행할 에이전트 목록 결정
 * 반환: [{ channelName, prompt }]
 */
function resolveTargets(sections) {
  const targets = [];

  if (sections.be) targets.push({ channelName: 'backend-dev',  prompt: sections.be });
  if (sections.fe) targets.push({ channelName: 'frontend-dev', prompt: sections.fe });
  if (sections.ai) targets.push({ channelName: 'ai-dev',       prompt: sections.ai });

  if (targets.length > 0) return targets;

  // 명시적 섹션 없음 → all 기반 자동 감지
  if (sections.all) {
    const channelName = resolveAgentFromContent(sections.all);
    targets.push({ channelName, prompt: sections.all });
  }

  return targets;
}

/**
 * 결과 Embed 빌드
 */
function buildResultEmbed(channelName, label, buffer, timedOut) {
  const hasError = buffer.includes('Error') || buffer.includes('[err]');
  const status = timedOut ? '⏰ 타임아웃' : (hasError ? '⚠️ 완료(오류 포함)' : '✅ 완료');
  const preview = buffer.slice(-1400) || '(출력 없음)';

  return new EmbedBuilder()
    .setTitle(`${label} — ${status}`)
    .setDescription(preview)
    .setColor(CHANNEL_COLORS[channelName] || 0x99AAB5)
    .setTimestamp();
}

/**
 * Claude subprocess → 스레드에 직접 결과 포스팅
 * 기획실 병렬 dispatch에서 사용
 * @returns Promise<{ channelName, label, buffer, timedOut }>
 */
async function runClaudeToThread(thread, userMessage, channelName, opts = {}) {
  // ── 메시지 정책 검증 (HG001/HG002) ──
  const validation = validateUserMessage(userMessage);
  if (validation.decision === 'deny') {
    const label = CHANNEL_LABELS[channelName] || channelName;
    const embed = new EmbedBuilder()
      .setTitle(`${label} — ❌ 차단됨`)
      .setDescription(`**정책 위반**: ${validation.reason}`)
      .setColor(0xFF0000)
      .setTimestamp();
    await thread.send({ embeds: [embed] });
    return { channelName, label, buffer: validation.reason, timedOut: false };
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) throw new Error('CLAUDE_PROJECT_DIR 환경변수 없음');

  // PR-PLAN1: plan 모드 — PLAN_CONTEXT 로 교체. 코드 변경 도구는 args 에서도 차단.
  let contextPrefix = opts.plan
    ? PLAN_CONTEXT
    : (AGENT_CONTEXTS[channelName] || AGENT_CONTEXTS['dev']);

  // CEO 역할일 때 큐 상태 동적 주입 (plan 모드는 큐 무관 — skip)
  if (channelName === 'ceo' && !opts.plan) {
    const queue = loadQueue();
    if (queue?.items?.length > 0) {
      const qStatus = getQueueSummary();
      contextPrefix = contextPrefix.replace(
        '[CEO 지시]',
        `[현재 큐 상태]\n${qStatus}\n\n[CEO 지시]`
      );
    }
  }

  const builtPrompt = await buildFullPrompt({
    projectDir,
    thread: opts.injectThreadContext ? thread : null,
    agentContext: contextPrefix,
    userMessage,
  });

  // claude-sync: 최근 이벤트(터미널+Discord 공유) 주입
  const syncContext = readRecentContext(20);
  const fullMessage = syncContext
    ? builtPrompt.replace('[사용자 지시]', syncContext + '[사용자 지시]')
    : builtPrompt;

  const label = CHANNEL_LABELS[channelName] || channelName;
  const model = getModelForRole(channelName);
  const modelTag = model ? ` · model: ${model}` : '';

  // claude-sync: user_msg 이벤트 기록
  const syncAgent = toSyncAgent(channelName);
  const threadId = thread?.id || null;
  recordDiscordEvent('user_msg', {
    agent: syncAgent,
    threadId,
    summary: userMessage.substring(0, 180),
  });

  const statusMsg = await thread.send(`⏳ **${label}** 작업 시작...${modelTag}`);
  let buffer = '';
  let lastUpdate = Date.now();

  const flushStatus = async () => {
    const preview = buffer.slice(-1200);
    try {
      await statusMsg.edit(`⏳ **${label}** 진행 중...${modelTag}\n${preview}`);
    } catch (_) {}
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'claude',
      buildClaudeArgs(channelName, { plan: opts.plan }),
      { cwd: projectDir, env: process.env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    proc.stdin.write(fullMessage);
    proc.stdin.end();

    proc.stdout.on('data', async (data) => {
      buffer += data.toString();
      if (Date.now() - lastUpdate > STREAM_INTERVAL_MS) {
        lastUpdate = Date.now();
        await flushStatus();
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('no stdin data received')) buffer += `[err] ${msg}`;
    });

    const timeout = setTimeout(() => {
      proc.kill();
      recordDiscordEvent('session_end', {
        agent: syncAgent,
        threadId,
        summary: `${label} 타임아웃 — ${userMessage.substring(0, 80)}`,
      });
      resolve({ channelName, label, buffer, timedOut: true });
    }, 30 * 60 * 1000);

    proc.on('close', () => {
      clearTimeout(timeout);
      // 진행 중 메시지 삭제 (결과 embed로 대체)
      statusMsg.delete().catch(() => {});

      // L2: ops context log + changelog에 작업 결과 기록
      const summary = extractSummary(buffer);
      const files = extractChangedFiles(buffer);
      writeOpsLog(projectDir, { agent: label, task: userMessage.substring(0, 200), summary, files });
      appendChangelog(projectDir, { agent: label, task: userMessage.substring(0, 200), summary, files });

      // claude-sync: assistant_reply + session_end 이벤트 기록
      recordDiscordEvent('assistant_reply', {
        agent: syncAgent,
        threadId,
        summary: summary.substring(0, 240),
        artifacts: files,
      });
      recordDiscordEvent('session_end', {
        agent: syncAgent,
        threadId,
        summary: `${label} 완료 — ${userMessage.substring(0, 80)}`,
        artifacts: files,
      });

      resolve({ channelName, label, buffer, timedOut: false });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Claude subprocess 실행 + Discord 실시간 스트리밍
 * 기존 채널 직접 메시지용 (에이전트 채널 messageCreate)
 */
async function runClaude(interaction, userMessage, opts = {}) {
  // ── 메시지 정책 검증 (HG001/HG002) ──
  const validation = validateUserMessage(userMessage);
  if (validation.decision === 'deny') {
    await interaction.editReply(
      `❌ **정책 위반**: ${validation.reason}\n\n` +
      `**이유**: 민감한 경로나 파괴 명령은 Discord 봇을 통해 실행할 수 없습니다.\n` +
      `로컬 개발 환경에서 직접 실행하거나, CEO 기획실의 승인이 필요합니다.`
    );
    return;
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    await interaction.editReply('`CLAUDE_PROJECT_DIR` 환경변수가 없습니다.');
    return;
  }

  const contextPrefix = AGENT_CONTEXTS[opts.channelName] || AGENT_CONTEXTS['dev'];
  const fullMessage = contextPrefix + userMessage;
  const model = getModelForRole(opts.channelName);
  const modelTag = model ? ` · ${model}` : '';

  const title = opts.taskTitle ? `**[${opts.taskTitle}]**\n` : '';
  const roleLabel = opts.channelName ? ` (${opts.channelName}${modelTag})` : modelTag;
  await interaction.editReply(
    `${title}⏳ Claude 에이전트${roleLabel} 실행 중...\n\`\`\`\n${userMessage.substring(0, 120)}${userMessage.length > 120 ? '...' : ''}\n\`\`\``
  );

  let buffer = '';
  let lastUpdate = Date.now();

  const flush = async (final = false) => {
    if (!buffer.trim() && !final) return;
    const status = final ? (buffer.includes('Error') ? '⚠️ 완료(오류 포함)' : '✅ 완료') : '⏳ 진행 중...';
    const preview = buffer.slice(-MAX_LEN + 80);
    const content = `${title}${status}${roleLabel}\n${preview}`;
    try {
      await interaction.editReply(content);
    } catch (_) {}
  };

  const proc = spawn(
    'claude',
    buildClaudeArgs(opts.channelName),
    { cwd: projectDir, env: process.env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  proc.stdin.write(fullMessage);
  proc.stdin.end();

  proc.stdout.on('data', async (data) => {
    buffer += data.toString();
    if (Date.now() - lastUpdate > STREAM_INTERVAL_MS || buffer.length > 3000) {
      lastUpdate = Date.now();
      await flush(false);
    }
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('no stdin data received')) return;
    buffer += `[err] ${msg}`;
  });

  const timeout = setTimeout(() => {
    proc.kill();
    interaction.followUp('⏰ 타임아웃 (30분)');
  }, 30 * 60 * 1000);

  proc.on('close', async () => {
    clearTimeout(timeout);
    await flush(true);
  });

  proc.on('error', async (err) => {
    clearTimeout(timeout);
    await interaction.editReply(`❌ \`claude\` CLI 실행 실패: ${err.message}\nclaude CLI가 PATH에 설치되어 있어야 합니다.`);
  });
}

/**
 * 메시지 내용 기반 에이전트 자동 라우팅
 */
// SSOT: whosbuying/.claude/agents/_router.json
// CLI(claudew) / Bridge MCP 와 동일 라우팅. fallback 시 인라인 키워드 사용.
let _routerCache = null;
function _loadRouter() {
  if (_routerCache) return _routerCache;
  try {
    const path = require('path');
    const fs = require('fs');
    const routerPath = path.resolve(
      __dirname,
      '../../../whosbuying/.claude/agents/_router.json'
    );
    _routerCache = require(routerPath);
  } catch (exc) {
    process.stderr.write(`[bot/router] SSOT load failed (${exc.message}); using inline fallback\n`);
    _routerCache = {
      default: 'claude-dev',
      agents: {
        'backend-dev': {
          keywords: ['spring', 'backend', '백엔드', 'server', '서버', 'api', 'java', 'kotlin', 'redis', 'rabbitmq', 'mariadb', 'websocket', 'stomp', 'controller', 'jpa', 'entity', 'dto', 'docker', 'gradle', '로비', 'lobby', '데이터베이스', 'database', '배포', 'deploy', 'endpoint', 'game_project_server'],
          globs: [],
        },
        'frontend-dev': {
          keywords: ['flutter', 'dart', '프론트', 'frontend', '화면', 'screen', '페이지', 'page', 'ui', 'ux', '앱', '위젯', 'widget', 'riverpod', '버튼', 'button', '레이아웃', 'layout', '애니메이션', 'animation', '스타일', 'style', '색상', 'color', 'game_project_app', 'game_project_web'],
          globs: [],
        },
      },
    };
  }
  return _routerCache;
}

function resolveAgentFromContent(userMessage, override) {
  if (override) return override;

  const router = _loadRouter();
  const msg = (userMessage || '').toLowerCase();
  const scores = {};

  for (const [agent, def] of Object.entries(router.agents || {})) {
    let score = 0;
    for (const kw of def.keywords || []) {
      if (msg.includes(kw.toLowerCase())) score += 1;
    }
    if (score > 0) scores[agent] = score;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  // 봇 기존 동작 보존: 매칭 없거나 동률이면 'claude-dev'
  if (ranked.length === 0) return 'claude-dev';
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return 'claude-dev';
  return ranked[0][0];
}

function resolveChannelName(interaction, override) {
  if (override) return override;
  const ch = interaction.channel?.name || '';
  if (AGENT_CONTEXTS[ch]) return ch;
  return 'claude-dev';
}

const SKILLS = {
  review:   (target) => `현재 변경된 파일(git diff HEAD)을 코드 리뷰해줘.${target ? ` 대상: ${target}` : ''}\n- 버그 가능성, 성능 이슈, 코드 스타일 순으로 정리\n- 심각도(High/Med/Low)를 붙여서 3줄 이내로 요약\n- 수정 제안은 diff 형태로`,
  sprint:   ()       => `docs/CURRENT_SPRINT.md 와 docs/DECISIONS.md 를 읽고:\n1. 현재 스프린트 진행 상태 요약\n2. 완료된 항목 / 남은 항목\n3. 다음 우선순위 3가지 제안`,
  pr:       (title)  => `현재 claude/dev 브랜치의 변경사항으로 main 대상 PR을 생성해줘.\n제목: ${title || '(변경 내용 기반으로 자동 생성)'}\n- PR 본문: 변경 이유, 주요 변경점, 테스트 방법 포함`,
  test:     (file)   => `${file ? `${file} 파일` : '최근 변경된 파일'}에 대한 유닛 테스트를 작성해줘.\n- 기존 테스트 스타일/프레임워크 따르기\n- 정상 케이스 + 엣지 케이스 포함`,
  explain:  (file)   => `${file ? `${file}` : '현재 작업 중인 핵심 파일'}을 읽고 설명해줘.\n- 목적, 주요 로직, 의존성을 한글로\n- 처음 보는 사람도 이해할 수 있는 수준`,
  'doc-sync': ()     => `API 문서 동기화 작업을 수행해줘.
1. game_project_server의 모든 Controller를 스캔해서 현재 엔드포인트 목록을 추출한다.
2. docs/API_REFERENCE.md의 내용과 비교한다.
3. 추가/변경/삭제된 엔드포인트가 있으면 docs/API_REFERENCE.md를 갱신한다.
4. WebSocket @MessageMapping도 확인한다.
5. 클라이언트(game_project_app)의 API client도 확인해서 파일:라인 참조를 업데이트한다.
6. 변경 사항을 요약하고, 변경이 없으면 "문서 최신 상태"라고 보고한다.`,
};

module.exports = {
  runClaude,
  runClaudeToThread,
  parseDispatchSections,
  resolveTargets,
  buildResultEmbed,
  CHANNEL_LABELS,
  SKILLS,
  resolveChannelName,
  resolveAgentFromContent,
  // CLI 어댑터(whosbuying/bin/claudew) 가 동일 컨텍스트 주입에 사용
  AGENT_CONTEXTS,
  PLAN_CONTEXT,

  async execute(interaction) {
    const message = interaction.options.getString('message');
    await interaction.deferReply();
    await runClaude(interaction, message, { channelName: 'dev' });
  },

  async executeSkill(interaction) {
    const skill  = interaction.options.getString('skill');
    const target = interaction.options.getString('target') || '';
    const skillFn = SKILLS[skill];
    if (!skillFn) {
      await interaction.reply({ content: `❌ 알 수 없는 스킬: ${skill}`, ephemeral: true });
      return;
    }
    const skillMessage = skillFn(target);
    await interaction.deferReply();
    const channelName = resolveAgentFromContent(target || skillMessage);
    await runClaude(interaction, skillMessage, { channelName });
  },

  /**
   * PR-PLAN1: /plan <task>
   * Read-only Claude 호출 — 코드 변경 없이 계획만 출력.
   * dispatch 와 같은 폼이지만 plan: true 옵션으로 도구 제한 + system prompt 강제.
   */
  async executePlan(interaction) {
    const message = interaction.options.getString('task');
    await interaction.deferReply();

    // 스레드 생성 — plan 결과를 스레드에 스트리밍
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const dd = String(new Date().getDate()).padStart(2, '0');
    const head = message.split('\n')[0].substring(0, 50);
    const threadName = `📋 [plan ${mm}/${dd}] ${head}`;

    let thread;
    try {
      const reply = await interaction.editReply(`📋 **plan 모드** — \`${head}\` 계획 수립 중…`);
      thread = await reply.startThread({ name: threadName, autoArchiveDuration: 1440 });
    } catch (err) {
      await interaction.editReply(`❌ 스레드 생성 실패: ${err.message}`);
      return;
    }

    const result = await runClaudeToThread(thread, message, 'ceo', { plan: true });
    await thread.send({
      embeds: [buildResultEmbed('ceo', `📋 plan — ${result.label}`, result.buffer, result.timedOut)],
    });
    await thread.send(
      '플랜만 수행했습니다. 실행하려면 이 스레드에 `---BE---/---FE---/---AI---` 형식으로 디스패치하거나, ' +
      '`#👔-ceo기획실` 채널에 같은 형식으로 보내세요.'
    );
  },
};
