const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { startInteractionServer } = require('./interaction-server');
const { startAlertsWatcher, ensureAlertsChannel } = require('./alerts-watcher');
const { execSync } = require('child_process');
const path = require('path');
const statusCmd   = require('./commands/status');
const roomsCmd    = require('./commands/rooms');
const closeRoomCmd = require('./commands/close-room');
const deployCmd   = require('./commands/deploy');
const {
  runClaude,
  runClaudeToThread,
  parseDispatchSections,
  resolveTargets,
  buildResultEmbed,
  CHANNEL_LABELS,
  execute: claudeExecute,
  executeBackend,
  executeFrontend,
  executeSkill,
} = require('./commands/claude');
const docsCmd     = require('./commands/docs');
const {
  loadQueue, saveQueue, pickNext, completeItem,
  currentItem, queueSummary, peekNext, recoverStaleItems,
} = require('./work-queue');
const { startPoller } = require('./sync-poller');
const { recordDiscordEvent } = require('./sync-writer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://game-server:8080';
const ADMIN_API_KEY   = process.env.ADMIN_API_KEY   || '';

/**
 * 에이전트 채널 목록 — 이모지 프리픽스 포함
 * 여기에 메시지를 보내면 통합 개발 에이전트(Claude)가 자동 실행됩니다.
 * BE/FE/AI 구분은 CEO 기획실의 디스패치 섹션(---BE---/---FE---/---AI---)으로만 처리.
 *
 * 내부 에이전트 역할 키는 'dev', '잡담'을 그대로 사용 (claude.js AGENT_CONTEXTS 매핑 유지).
 */
const AGENT_CHANNELS = new Map([
  ['⚡-dev', 'dev'],
  ['💬-잡담', '잡담'],
]);

/**
 * CEO 기획실 채널
 * 이 채널에서 메시지 전송 → 스레드 생성 + BE/FE/AI 병렬 dispatch
 * 🤖 반응도 지원 (재디스패치용)
 */
const CEO_CHANNEL = process.env.CEO_CHANNEL_NAME || '👔-ceo기획실';
const DISPATCH_CHANNELS = new Set([CEO_CHANNEL]);
const TRIGGER_EMOJI = '🤖';

// ─── 봇 준비 ─────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`[Bot] 로그인 완료: ${client.user.tag}`);
  console.log(`[Bot] 에이전트 채널: ${[...AGENT_CHANNELS.keys()].map(c => '#' + c).join(', ')}`);
  console.log(`[Bot] CEO 기획실: #${CEO_CHANNEL} (메시지 전송 또는 ${TRIGGER_EMOJI} 반응 시 병렬 dispatch)`);

  // work-queue 상태 확인 + stale in_progress 복구
  const staleRecovered = recoverStaleItems();
  if (staleRecovered.length > 0) {
    console.warn(`[Bot] ${staleRecovered.length}개 stale in_progress 아이템을 failed로 복구: ${staleRecovered.map(i => i.id).join(', ')}`);
  }

  const queue = loadQueue();
  let queueStats = { total: 0, done: 0, inProg: 0, pending: 0 };
  if (queue?.items) {
    queueStats = {
      total: queue.items.length,
      done: queue.items.filter(i => i.status === 'done').length,
      inProg: queue.items.filter(i => i.status === 'in_progress').length,
      pending: queue.items.filter(i => i.status === 'pending').length,
    };
    console.log(`[Bot] loaded work-queue: ${queueStats.total} items (done=${queueStats.done}, in_progress=${queueStats.inProg}, pending=${queueStats.pending})`);
  } else {
    console.log('[Bot] work-queue: 없음');
  }

  // 기동 공지: #alerts 채널에 온라인 embed (커밋 SHA + 큐 상태 + stale 복구 + 시각)
  try {
    await sendOnlineNotice(client, { staleRecovered, queueStats });
  } catch (err) {
    console.error('[Bot] 온라인 공지 실패:', err.message);
  }

  // docker health_status → #alerts 푸시 watcher (실패해도 봇은 계속 동작)
  try {
    await startAlertsWatcher(client);
  } catch (err) {
    console.error('[Bot] alerts-watcher 시작 실패:', err.message);
  }

  // claude-sync 폴러 (터미널+Discord 이벤트 공유 + digest 생성)
  try {
    startPoller({ client });
  } catch (err) {
    console.error('[Bot] sync-poller 시작 실패:', err.message);
  }
});

/**
 * 봇 기동 공지 — #alerts 채널에 "🟢 프로젝트매니저 온라인" embed를 전송한다.
 * 커밋 SHA, 큐 상태, stale 복구 건수, 시각을 필드로 표기해 재시작 반영 여부를 즉시 눈으로 확인하게 한다.
 */
async function sendOnlineNotice(client, { staleRecovered = [], queueStats = {} } = {}) {
  const channel = await ensureAlertsChannel(client);
  if (!channel) return;

  const repoRoot = path.resolve(__dirname, '..');
  let sha = 'unknown';
  let dirty = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const status = execSync('git status --porcelain', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (status) dirty = ' (dirty)';
  } catch (err) {
    console.warn('[Bot] git SHA 조회 실패:', err.message);
  }

  const nowKst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  const qs = queueStats;
  const queueLine = qs.total
    ? `done=${qs.done}, in_progress=${qs.inProg}, pending=${qs.pending} (total=${qs.total})`
    : '없음';
  const staleLine = staleRecovered.length
    ? `${staleRecovered.length}건 (${staleRecovered.map(i => i.id).join(', ')})`
    : '0건';

  const embed = new EmbedBuilder()
    .setTitle('🟢 프로젝트매니저 온라인')
    .setColor(0x2ecc71)
    .addFields(
      { name: '커밋 SHA', value: `\`${sha}\`${dirty}`, inline: true },
      { name: '큐 상태', value: queueLine, inline: false },
      { name: 'stale 복구', value: staleLine, inline: true },
      { name: '시각 (KST)', value: nowKst, inline: true },
    )
    .setFooter({ text: '재시작 후 이 공지가 안 뜨면 봇이 실제로 로드되지 않은 것' });

  await channel.send({ embeds: [embed] });
}

/**
 * Slash command 라우팅 — Gateway와 HTTP 양쪽에서 재사용
 * @param {string} commandName
 * @param {import('discord.js').ChatInputCommandInteraction|object} interaction
 */
async function routeCommand(commandName, interaction) {
  const ctx = { GAME_SERVER_URL, ADMIN_API_KEY, EmbedBuilder };
  switch (commandName) {
    case 'game-server-status':
                       await statusCmd.execute(interaction, ctx);    break;
    case 'game-rooms': await roomsCmd.execute(interaction, ctx);     break;
    case 'close-room': await closeRoomCmd.execute(interaction, ctx); break;
    case 'deploy':     await deployCmd.execute(interaction, ctx);    break;
    case 'dev':        await claudeExecute(interaction);             break;
    case 'skill':      await executeSkill(interaction);              break;
    case 'docs':       await docsCmd.execute(interaction);           break;
    case 'dispatch':   await handleDispatchCommand(interaction);     break;
    default:
      if (typeof interaction.reply === 'function') {
        await interaction.reply({ content: '알 수 없는 명령입니다.', ephemeral: true });
      }
  }
}

// ─── 슬래시 커맨드 + 컴포넌트 인터랙션 (Gateway) ───────────
client.on('interactionCreate', async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'docs_select') {
      try { await docsCmd.handleSelect(interaction); } catch (err) {
        console.error('[Bot] docs select 오류:', err);
        const reply = { content: `오류: ${err.message}`, ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
        else await interaction.reply(reply);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  try {
    await routeCommand(interaction.commandName, interaction);
  } catch (err) {
    console.error(`[Bot] 명령 오류: ${interaction.commandName}`, err);
    const reply = { content: `오류: ${err.message}`, ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch (_) {}
  }
});

// ─── 에이전트 채널: 메시지 → 스레드 생성 + Claude 실행 ──
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── 큐 관리 명령어 (!큐상태, !큐시작, !큐중지) — 어디서든 사용 가능 ──
  const cmd = message.content.trim();
  if (cmd === '!큐상태') {
    await message.reply(queueSummary());
    return;
  }
  if (cmd === '!큐시작') {
    await handleQueueStart(message.channel);
    return;
  }
  if (cmd === '!큐중지') {
    const cur = currentItem();
    if (!cur) {
      await message.reply('현재 진행 중인 큐 아이템이 없습니다.');
      return;
    }
    completeItem(cur.id, false);
    await message.reply(`⏸️ 큐 중지: **${cur.id}** → failed 처리. 다시 진행하려면 CEO 기획실에서 "진행해"라고 말하세요.`);
    return;
  }

  // 스레드 내 !닫기 → 즉시 아카이브
  if (message.content.trim() === '!닫기' && message.channel.isThread()) {
    try {
      await message.react('✅');
      await message.channel.setArchived(true);
    } catch (err) {
      console.error('[Bot] 스레드 닫기 오류:', err);
      await message.reply(`❌ 스레드 닫기 실패: ${err.message}`);
    }
    return;
  }

  // !봇가이드 → 채널에 공지용 가이드 메시지 게시 (고정 권장)
  if (message.content.trim() === '!봇가이드') {
    const guide = [
      '📌 **누가살래 봇 사용 가이드**',
      '',
      '**슬래시 커맨드** (어디서나 `/` 입력 후 선택)',
      '`/game-server-status` — 서버 상태 확인',
      '`/game-rooms` — 현재 활성 방 목록',
      '`/close-room` — 특정 방 강제 종료',
      '`/deploy` — 서버 배포 트리거',
      '`/dev` — 개발 에이전트에게 직접 지시',
      '`/docs` — 프로젝트 문서 조회',
      '',
      '**채널별 메시지 전송**',
      '`#⚡-dev` — 메시지 전송 → 개발 에이전트가 자동 응답 (스레드 생성)',
      '`#💬-잡담` — 일반 대화',
      '`#👔-ceo기획실` — 기획 논의 또는 `---BE---/---FE---/---AI---` 포함 시 에이전트 병렬 디스패치',
      '',
      '**스레드 안에서**',
      '`!닫기` — 현재 스레드 닫기 (아카이브)',
      '메시지 계속 입력 → 이전 대화 맥락 유지하며 에이전트 응답',
      '',
      '**반응**',
      '`🤖` 반응 (CEO 기획실 메시지에) → 에이전트 디스패치 재실행',
    ].join('\n');
    try {
      const posted = await message.channel.send(guide);
      await posted.pin().catch(() => {}); // 권한 있으면 자동 고정
      await message.react('📌');
    } catch (err) {
      await message.reply(`❌ 가이드 게시 실패: ${err.message}`);
    }
    return;
  }

  if (message.content.startsWith('/')) return;

  const channelName = message.channel.name;
  const userMessage = message.content;

  // ── CEO 기획실: ---BE---/---FE---/---AI--- 있으면 디스패치, 없으면 대화 모드 ──
  if (DISPATCH_CHANNELS.has(channelName)) {
    const hasDispatchSections = /---\s*(BE|FE|AI|ALL)\s*---/i.test(userMessage);

    if (hasDispatchSections) {
      // 디스패치 모드: 에이전트에 작업 명령
      try {
        await message.react('⏳');

        const mm = String(new Date().getMonth() + 1).padStart(2, '0');
        const dd = String(new Date().getDate()).padStart(2, '0');
        const taskTitle = userMessage.split('\n')[0].substring(0, 45);
        const threadName = `🎯 [${mm}/${dd}] ${taskTitle}`;

        const thread = await message.startThread({
          name: threadName,
          autoArchiveDuration: 1440,
        });

        await dispatchToAgents(thread, userMessage);

        const r = message.reactions.cache.get('⏳');
        if (r) await r.remove().catch(() => {});
        await message.react('✅');
      } catch (err) {
        console.error(`[Bot] dispatch 오류:`, err);
        await message.reply(`❌ 오류: ${err.message}`);
      }
    } else {
      // 대화 모드: CEO와 기획 논의 (Claude가 기획 어드바이저로 응답)
      try {
        await message.react('⏳');

        const threadTitle = `💬 ${userMessage.substring(0, 60)}`;
        const thread = await message.startThread({
          name: threadTitle,
          autoArchiveDuration: 1440,
        });

        const { label, buffer, timedOut } = await runClaudeToThread(
          thread, userMessage, 'ceo',
          { injectThreadContext: false }
        );

        const r = message.reactions.cache.get('⏳');
        if (r) await r.remove().catch(() => {});
        await message.react('✅');

        // <<START_QUEUE>> 태그를 응답에서 제거하고 embed에 표시
        const cleanBuffer = buffer.replace(/<<START_QUEUE>>/g, '').trim();
        await thread.send({ embeds: [buildResultEmbed('ceo', label, cleanBuffer, timedOut)] });

        // CEO가 큐 진행을 승인 → 자동 디스패치 시작
        // pending 아이템이 있을 때만 호출. 없으면 사일런트 대신 경고 reply로 가시화.
        if (buffer.includes('<<START_QUEUE>>')) {
          if (peekNext()) {
            await handleQueueStart(thread);
          } else {
            await thread.send(
              '⚠️ 큐에 pending 아이템 없음 — `<<START_QUEUE>>`는 기존 pending을 pick할 뿐 채팅 텍스트를 파싱해 append하지 않습니다.\n' +
              '큐에 새 PR을 넣으려면 `project-manager/work-queue.json`을 직접 편집해야 합니다.\n' +
              '단건 PR이면 디스패치 채널로 `---BE---/---FE---/---AI---` 블록을 바로 보내는 편이 빠릅니다.\n' +
              '런북: `project-manager/docs/INCIDENT_QUEUE_APPEND_MISSING.md`'
            );
          }
        }
      } catch (err) {
        console.error(`[Bot] CEO 대화 오류:`, err);
        await message.reply(`❌ 오류: ${err.message}`);
      }
    }
    return;
  }

  // ── 스레드 내 follow-up 메시지: 이전 대화 컨텍스트 포함하여 재실행 ──
  if (message.channel.isThread()) {
    const parentChannel = message.channel.parent;
    if (!parentChannel) return;
    const parentName = parentChannel.name;

    // 에이전트 채널 또는 디스패치 채널의 스레드인 경우만 처리
    if (!AGENT_CHANNELS.has(parentName) && !DISPATCH_CHANNELS.has(parentName)) return;

    try {
      // 스레드 내 dispatch 블록 감지 → 현재 스레드에서 바로 병렬 디스패치
      // (최상위 채널로 올릴 필요 없이 스레드 안에서 ---BE---/---FE---/---AI--- 바로 실행)
      if (DISPATCH_CHANNELS.has(parentName) && /---\s*(BE|FE|AI|ALL)\s*---/i.test(userMessage)) {
        await message.react('⏳');
        await dispatchToAgents(message.channel, userMessage);
        const r0 = message.reactions.cache.get('⏳');
        if (r0) await r0.remove().catch(() => {});
        await message.react('✅');
        return;
      }

      await message.react('⏳');

      const agentChannel = AGENT_CHANNELS.has(parentName) ? AGENT_CHANNELS.get(parentName)
        : DISPATCH_CHANNELS.has(parentName) ? 'ceo'
        : 'dev';
      const { label, buffer, timedOut } = await runClaudeToThread(
        message.channel, userMessage, agentChannel,
        { injectThreadContext: true }
      );

      const r = message.reactions.cache.get('⏳');
      if (r) await r.remove().catch(() => {});
      await message.react('✅');

      const cleanBuffer = buffer.replace(/<<START_QUEUE>>/g, '').trim();
      await message.channel.send({ embeds: [buildResultEmbed(agentChannel, label, cleanBuffer, timedOut)] });

      // CEO 스레드에서 큐 시작 승인 감지
      // pending 아이템이 있을 때만 호출. 없으면 사일런트 대신 경고 reply로 가시화.
      if (agentChannel === 'ceo' && buffer.includes('<<START_QUEUE>>')) {
        if (peekNext()) {
          await handleQueueStart(message.channel);
        } else {
          await message.channel.send(
            '⚠️ 큐에 pending 아이템 없음 — `<<START_QUEUE>>`는 기존 pending을 pick할 뿐 채팅 텍스트를 파싱해 append하지 않습니다.\n' +
            '큐에 새 PR을 넣으려면 `project-manager/work-queue.json`을 직접 편집해야 합니다.\n' +
            '런북: `project-manager/docs/INCIDENT_QUEUE_APPEND_MISSING.md`'
          );
        }
      }
    } catch (err) {
      console.error(`[Bot] 스레드 follow-up 오류:`, err);
      await message.reply(`❌ 오류: ${err.message}`);
    }
    return;
  }

  // ── 에이전트 채널: 단일 에이전트 실행 ──
  if (!AGENT_CHANNELS.has(channelName)) return;
  const agentRole = AGENT_CHANNELS.get(channelName);

  try {
    await message.react('⏳');

    // 스레드 생성 (첫 80자를 제목으로)
    const threadTitle = userMessage.substring(0, 80);
    const thread = await message.startThread({
      name: threadTitle,
      autoArchiveDuration: 60,
    });

    const { label, buffer, timedOut } = await runClaudeToThread(thread, userMessage, agentRole);

    const r = message.reactions.cache.get('⏳');
    if (r) await r.remove().catch(() => {});
    await message.react('✅');

    await thread.send({ embeds: [buildResultEmbed(agentRole, label, buffer, timedOut)] });
  } catch (err) {
    console.error(`[Bot] ${channelName} 오류:`, err);
    await message.reply(`❌ 오류: ${err.message}`);
  }
});

// ─── CEO 기획실: 🤖 반응 → 스레드 생성 + 병렬 dispatch ───
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== TRIGGER_EMOJI) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  const msg = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : reaction.message;
  if (!msg) return;
  if (msg.channel.name !== CEO_CHANNEL) return;

  const taskContent = msg.content?.trim();
  if (!taskContent) return;

  // 스레드 제목 생성 (날짜 포함)
  const mm = String(new Date().getMonth() + 1).padStart(2, '0');
  const dd = String(new Date().getDate()).padStart(2, '0');
  const today = `${mm}/${dd}`;
  const taskTitle = taskContent.split('\n')[0].substring(0, 45);
  const threadName = `🎯 [${today}] ${taskTitle}`;

  if (msg.hasThread) {
    // 이미 스레드 존재 → 이름 갱신 후 재디스패치
    const existingThread = msg.thread;
    try { await existingThread.setName(threadName); } catch (_) {}
    await existingThread.send(`🔄 **재디스패치** — 지시문이 업데이트되었습니다.`);
    await dispatchToAgents(existingThread, taskContent);
    return;
  }

  const thread = await msg.startThread({
    name: threadName,
    autoArchiveDuration: 1440,
  });

  await dispatchToAgents(thread, taskContent);
});

/**
 * /dispatch 슬래시 커맨드 핸들러
 * CEO 기획실이 아닌 곳에서도 병렬 dispatch 실행 가능
 */
async function handleDispatchCommand(interaction) {
  const directive = interaction.options.getString('directive');
  await interaction.deferReply();

  const sections = parseDispatchSections(directive);
  const targets = resolveTargets(sections);

  if (targets.length === 0) {
    await interaction.editReply('❌ 실행할 에이전트가 없습니다. 지시문을 확인해주세요.');
    return;
  }

  const targetLabels = targets.map(t => CHANNEL_LABELS[t.channelName] || t.channelName).join(', ');
  await interaction.editReply(`📋 **디스패치 시작** — ${targetLabels}\n\`\`\`\n${directive.substring(0, 200)}\n\`\`\``);

  // 스레드에서 실행하거나 채널에서 follow-up으로 결과 전송
  const channel = interaction.channel;
  const results = await Promise.allSettled(
    targets.map(t => runClaudeToThread(channel, t.prompt, t.channelName))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { channelName, label, buffer, timedOut } = result.value;
      await channel.send({ embeds: [buildResultEmbed(channelName, label, buffer, timedOut)] });
    } else {
      await channel.send(`❌ 에이전트 오류: ${result.reason?.message}`);
    }
  }

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  await interaction.followUp(`✅ **전체 완료** — ${succeeded}/${results.length} 에이전트 성공`);
}

/**
 * CEO 기획실 지시문을 파싱하여 에이전트에 병렬 dispatch
 * 각 에이전트 완료 후 스레드에 결과 Embed 포스팅
 *
 * 지시문 작성 형식:
 *   섹션 구분자 없음  → 키워드 자동 감지 (단일 에이전트)
 *   ---BE---          → Spring Boot 에이전트
 *   ---FE---          → Flutter 에이전트
 *   ---AI---          → AI 서버 에이전트
 *   ---ALL---         → 감지된 단일 에이전트 (현재는 자동 감지와 동일)
 *
 * 예시:
 *   게임 시작 기능 추가
 *
 *   ---BE---
 *   POST /api/v1/rooms/{code}/start 엔드포인트 추가, RabbitMQ 이벤트 발행
 *
 *   ---FE---
 *   게임 시작 버튼 UI 추가, 시작 API 호출 후 게임 화면 전환
 *
 *   ---AI---
 *   게임 시작 시 라운드별 프롬프트 생성 로직 추가
 */
// 체이닝 재귀 깊이 제한 — dispatchToAgents → maybeAutoChain → dispatchQueueItem → dispatchToAgents 루프 방지
const MAX_CHAIN_DEPTH = 20;
let _chainDepth = 0;

async function dispatchToAgents(thread, taskContent) {
  // 체이닝 재귀 깊이 확인
  _chainDepth++;
  if (_chainDepth > MAX_CHAIN_DEPTH) {
    console.error(`[Dispatch] 체이닝 깊이 초과 (${_chainDepth}/${MAX_CHAIN_DEPTH}) — 무한루프 방지를 위해 중단`);
    await thread.send(`❌ **체이닝 깊이 초과** (${MAX_CHAIN_DEPTH}회) — 무한루프 방지를 위해 자동 중단되었습니다. \`!큐상태\`로 확인하세요.`);
    _chainDepth--;
    return;
  }

  try {

  const sections = parseDispatchSections(taskContent);
  const targets = resolveTargets(sections);

  if (targets.length === 0) {
    await thread.send('❌ 실행할 에이전트가 없습니다. 지시문을 확인해주세요.');
    return;
  }

  // 시작 요약 메시지
  const targetLabels = targets.map(t => CHANNEL_LABELS[t.channelName] || t.channelName).join('  |  ');
  const preview = taskContent.substring(0, 400);
  await thread.send(
    `📋 **CEO 기획실 디스패치**\n` +
    `에이전트: ${targetLabels}\n\n` +
    `**지시문:**\n\`\`\`\n${preview}${taskContent.length > 400 ? '\n...(생략)' : ''}\n\`\`\``
  );

  // 병렬 실행
  console.log(`[Dispatch] ${targets.map(t => t.channelName).join(', ')} 병렬 시작`);
  const results = await Promise.allSettled(
    targets.map(t => runClaudeToThread(thread, t.prompt, t.channelName))
  );

  // 각 에이전트 결과 Embed 포스팅
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { channelName, label, buffer, timedOut } = result.value;
      await thread.send({ embeds: [buildResultEmbed(channelName, label, buffer, timedOut)] });
    } else {
      await thread.send(`❌ 에이전트 오류: ${result.reason?.message}`);
    }
  }

  // 전체 완료 요약
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const allOk = succeeded === results.length;
  await thread.send(
    `${allOk ? '✅' : '⚠️'} **전체 완료** — ${succeeded}/${results.length} 에이전트 성공\n` +
    `이 스레드에서 결과를 확인하고 추가 지시를 입력하세요.`
  );

  // ─── 체이닝 훅: 큐 아이템 완료 + 다음 자동 디스패치 ───
  await maybeAutoChain(thread, allOk);

  } finally {
    _chainDepth--;
  }
}

// ─── Helper ──────────────────────────────────────────────
function makeFakeInteraction(message) {
  let first = true;
  return {
    options: { getString: () => message.content },
    deferReply: async () => {},
    editReply: async (text) => {
      const s = typeof text === 'string' ? text : JSON.stringify(text);
      if (first) { first = false; await message.reply(s); }
      else await message.channel.send(s);
    },
    followUp: async (text) => {
      await message.channel.send(typeof text === 'string' ? text : JSON.stringify(text));
    },
    deferred: true, replied: false,
  };
}

// ─── 체이닝: 큐 아이템 완료 → 같은 스레드에서 다음 자동 디스패치 ─────
/**
 * 현재 in_progress 큐 아이템을 완료 처리하고, 같은 스레드에서 다음 아이템을 자동 디스패치.
 * dispatchToAgents 완료 후 호출됨.
 */
async function maybeAutoChain(thread, success) {
  const cur = currentItem();
  if (!cur) return; // 큐 아이템이 아닌 일반 디스패치

  const queue = loadQueue();
  const total = queue?.items?.length || 0;
  const doneCount = (queue?.items?.filter(i => i.status === 'done').length || 0) + 1; // 현재 것 포함

  // 현재 아이템 완료 처리
  completeItem(cur.id, success);
  console.log(`[Chain] ${cur.id} 완료 (${success ? 'success' : 'failed'})`);

  if (!success) {
    await thread.send(
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ **${cur.id} 실패** — 체이닝 일시정지 (${doneCount - 1}/${total} 완료)\n` +
      `재시작: CEO 기획실에서 "진행해" 또는 \`!큐시작\``
    );
    return;
  }

  // 다음 아이템 확인
  const next = peekNext();
  if (!next) {
    // 전체 완료
    await thread.send(
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎉 **큐 전체 완료!** (${total}/${total})\n\n` +
      `${queueSummary()}\n\n` +
      `모든 아이템이 처리되었습니다.`
    );
    return;
  }

  // 다음 아이템 진행 — 같은 스레드에서 계속
  const nextItem = pickNext();
  await thread.send(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ **${cur.id}** 완료 (${doneCount}/${total})\n` +
    `🔗 **다음** → **${nextItem.id}** (${nextItem.title}) · ${nextItem.agent}\n` +
    `남은 큐: ${total - doneCount - 1}개\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );

  console.log(`[Chain] chaining ${nextItem.id} in same thread`);
  await dispatchToAgents(thread, nextItem.prompt);
}

/**
 * 큐 시작 — <<START_QUEUE>> 감지, !큐시작, HTTP /queue/start에서 호출
 * CEO 기획실에 하나의 스레드를 만들고 거기서 전체 큐를 순차 진행.
 */
async function handleQueueStart(notifyChannel) {
  const cur = currentItem();
  if (cur) {
    await notifyChannel.send(`이미 진행 중: **${cur.id}** (${cur.title})`);
    return;
  }
  const next = pickNext();
  if (!next) {
    const q = loadQueue();
    const total = q?.items?.length || 0;
    if (total === 0) {
      await notifyChannel.send(
        `📭 **큐 비어있음** — \`project-manager/work-queue.json\`에 아이템이 없습니다.\n` +
        `새 작업을 추가하려면 CEO 기획실에서 기획 논의 후 디스패치 섹션(\`---BE---/---FE---/---AI---\`)으로 지시하거나, work-queue.json을 직접 편집하세요.`
      );
      return;
    }
    const done   = q.items.filter(i => i.status === 'done').length;
    const failed = q.items.filter(i => i.status === 'failed').length;
    const allDone = done === total;
    const header = allDone
      ? `✅ **모든 큐 아이템 처리 완료** (${done}/${total})`
      : `⏹️ **pending 아이템 없음** — 진행 가능한 작업이 없습니다`;
    const hint = failed > 0
      ? `실패 ${failed}건이 있습니다. 재시도하려면 work-queue.json에서 해당 아이템의 \`status\`를 \`pending\`으로 되돌리고 \`!큐시작\`.`
      : `새 아이템을 추가하려면 work-queue.json에 append 후 \`!큐시작\`, 또는 CEO 기획실에서 새 지시문을 작성하세요.`;
    await notifyChannel.send(`${header}\n\n${queueSummary()}\n\n${hint}`);
    return;
  }

  const queue = loadQueue();
  const total = queue?.items?.length || 0;
  const mm = String(new Date().getMonth() + 1).padStart(2, '0');
  const dd = String(new Date().getDate()).padStart(2, '0');
  const itemList = queue.items.map((item, i) =>
    `${i + 1}. **${item.id}** — ${item.title} (${item.agent})`
  ).join('\n');
  const dashboardUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000') + '/queue';

  // OPS7: 호출자가 이미 스레드(CEO가 기획실에서 논의 중인 스레드)면 거기서 그대로 큐 진행.
  // 별도 스레드/메시지를 띄우면 CEO가 트리거한 위치와 큐 진행 위치가 달라져 혼란.
  if (notifyChannel.isThread && notifyChannel.isThread()) {
    await notifyChannel.send(
      `📋 **큐 디스패치 시작** — ${total}개 아이템\n${itemList}\n\n📊 [실시간 대시보드](${dashboardUrl})\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🚀 **시작** → **${next.id}** (${next.title}) · ${next.agent}\n` +
      `전체: ${total}개 · 남은 큐: ${total - 1}개\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
    console.log(`[Chain] queue start: ${next.id} in existing thread ${notifyChannel.name}`);
    await dispatchToAgents(notifyChannel, next.prompt);
    return;
  }

  // Fallback: 일반 채널(!큐시작) 또는 HTTP /queue/start — CEO 메인 채널에 kickMsg + 새 스레드
  const ceoChannel = client.channels.cache.find(
    ch => ch.name === CEO_CHANNEL && ch.isTextBased() && !ch.isThread()
  );
  if (!ceoChannel) {
    await notifyChannel.send(`❌ CEO 채널을 찾을 수 없습니다.`);
    return;
  }

  const kickMsg = await ceoChannel.send(
    `📋 **큐 디스패치 시작** — ${total}개 아이템\n${itemList}\n\n📊 [실시간 대시보드](${dashboardUrl})`
  );

  const thread = await kickMsg.startThread({
    name: `🔗 [${mm}/${dd}] 큐 디스패치 (${total}개)`,
    autoArchiveDuration: 1440,
  });

  await thread.send(
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🚀 **시작** → **${next.id}** (${next.title}) · ${next.agent}\n` +
    `전체: ${total}개 · 남은 큐: ${total - 1}개\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );

  console.log(`[Chain] queue start: ${next.id} in thread ${thread.name}`);
  await dispatchToAgents(thread, next.prompt);
}

// (큐 관리 명령어는 위 messageCreate 핸들러에 통합됨)

client.on('error', (err) => console.error('[Bot] 클라이언트 오류:', err));
process.on('unhandledRejection', (err) => console.error('[Bot] 미처리 거부:', err));

client.login(process.env.DISCORD_TOKEN);

// ─── HTTP Interaction 서버 (Cloudflare Worker 포워딩 수신) ──
// PC 꺼진 상태에서 /wakeup은 Cloudflare Worker가 직접 처리하고,
// PC 켜진 상태의 나머지 명령은 Worker → 이 HTTP 서버로 포워딩됨.
const BOT_HTTP_PORT = parseInt(process.env.BOT_HTTP_PORT || '4040', 10);
const BOT_FORWARD_SECRET = process.env.BOT_FORWARD_SECRET || '';

startInteractionServer({
  port: BOT_HTTP_PORT,
  forwardSecret: BOT_FORWARD_SECRET,
  handleCommand: async (commandName, fakeInteraction) => {
    console.log(`[Interaction] HTTP command: /${commandName}`);
    await routeCommand(commandName, fakeInteraction);
  },
  onQueueStart: async () => {
    // handleQueueStart 내부에서 CEO 채널 탐색 + 스레드 생성
    // notifyChannel은 fallback용 (스레드 생성 전 에러 메시지용)
    const fallback = client.channels.cache.find(
      ch => ch.name === CEO_CHANNEL && ch.isTextBased() && !ch.isThread()
    );
    if (!fallback) throw new Error('CEO 채널 없음');
    await handleQueueStart(fallback);
  },
  onQueueStatus: () => queueSummary(),
  onQueueRaw: () => loadQueue() || { items: [] },
});
