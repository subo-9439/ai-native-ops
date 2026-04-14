const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { startInteractionServer } = require('./interaction-server');
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
client.once('clientReady', () => {
  console.log(`[Bot] 로그인 완료: ${client.user.tag}`);
  console.log(`[Bot] 에이전트 채널: ${[...AGENT_CHANNELS.keys()].map(c => '#' + c).join(', ')}`);
  console.log(`[Bot] CEO 기획실: #${CEO_CHANNEL} (메시지 전송 또는 ${TRIGGER_EMOJI} 반응 시 병렬 dispatch)`);
});

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

        await thread.send({ embeds: [buildResultEmbed('dev', label, buffer, timedOut)] });
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

      await message.channel.send({ embeds: [buildResultEmbed(agentChannel, label, buffer, timedOut)] });
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
async function dispatchToAgents(thread, taskContent) {
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
});
