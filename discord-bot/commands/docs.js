const fs   = require('fs');
const path = require('path');
const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');

// ─── 문서 목록 ────────────────────────────────────────────────────────────────
const DOCS = [
  { label: '📋 프로젝트 개요',         value: 'prd_overview',    file: 'docs/PRD/PROJECT_OVERVIEW.md' },
  { label: '💰 수익화 전략',           value: 'prd_monetize',    file: 'docs/PRD/MONETIZATION.md' },
  { label: '🏗️ 아키텍처 목표',         value: 'arch_target',     file: 'docs/ARCH/target_state.md' },
  { label: '🎮 비즈니스 로직/테이블',  value: 'biz_logic',       file: 'docs/BUSINESS_LOGIC_AND_TABLES.md' },
  { label: '🖥️ 화면 계획',            value: 'screen_plan',     file: 'docs/SCREEN_PLAN.md' },
  { label: '🔌 임베드 가이드',         value: 'embed_guide',     file: 'docs/EMBED_GUIDE.md' },
  { label: '🔗 브릿지 설계',           value: 'bridge',          file: 'docs/BRIDGE.md' },
  { label: '📡 채널 설계',             value: 'channel',         file: 'docs/CHANNEL.md' },
  { label: '🔗 통합 가이드',           value: 'integration',     file: 'docs/integration/INTEGRATION_GUIDE.md' },
  { label: '🚀 GitHub Actions 셋업',  value: 'gh_actions',      file: 'docs/GITHUB_ACTIONS_SETUP.md' },
  { label: '🛠️ 셀프호스트 셋업',       value: 'selfhost',        file: 'docs/SELFHOST_SETUP.md' },
  { label: '🤖 AI 설정 동기화',        value: 'ai_config',       file: 'docs/AI_CONFIG_SYNC.md' },
  { label: '🧠 하네스 분할 가이드',    value: 'harness_split',   file: 'docs/ai/HARNESS_SPLIT_GUIDE.md' },
  { label: '🎯 경매 미니게임 설계',    value: 'game_auction',    file: 'docs/game_design_auction_minigame.md' },
  { label: '💣 폭탄 도미노 설계',      value: 'game_bomb',       file: 'docs/game_design_bomb_domino_detail.md' },
  { label: '🎨 UI 컴포넌트 규칙',      value: 'ui_rules',        file: 'docs/ui_component_rules.md' },
  { label: '🔄 라운드 레디 수정',      value: 'round_ready',     file: 'docs/round_ready_process_fix.md' },
  { label: '📊 SQL 로깅',              value: 'sql_logging',     file: 'docs/SQL_LOGGING.md' },
  { label: '🌐 WebSocket 에러 추적',   value: 'ws_errors',       file: 'docs/websocket_error_tracking_test_guide.md' },
  { label: '🔍 통합 에러 추적 테스트', value: 'error_tracking',  file: 'docs/unified_error_tracking_test_guide.md' },
  { label: '📝 작업 로그',             value: 'work_log',        file: 'docs/WORK_LOG.md' },
];

const MAX_CHUNK = 1900;

// 줄 단위로 자름 — 코드블록 중간 절단 방지
function splitIntoChunks(text) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const appended = current ? current + '\n' + line : line;
    if (appended.length > MAX_CHUNK && current) {
      chunks.push(current);
      current = line;
    } else {
      current = appended;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ─── /docs 슬래시 커맨드 실행 ─────────────────────────────────────────────────
async function execute(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const select = new StringSelectMenuBuilder()
    .setCustomId('docs_select')
    .setPlaceholder('📚 볼 문서를 선택하세요...')
    .addOptions(DOCS.map(d => ({ label: d.label, value: d.value })));

  const row = new ActionRowBuilder().addComponents(select);

  const embed = new EmbedBuilder()
    .setTitle('📚 프로젝트 문서 인덱스')
    .setDescription(
      '아래 드롭다운에서 문서를 선택하면\n' +
      '이 채널에 **스레드**가 생성되고 전체 내용이 올라갑니다.'
    )
    .setColor(0x5865F2)
    .addFields(
      { name: '📋 PRD',       value: 'PROJECT_OVERVIEW · MONETIZATION',                  inline: false },
      { name: '🏗️ 아키텍처', value: 'ARCH · BRIDGE · CHANNEL · INTEGRATION',             inline: false },
      { name: '🎮 게임/UI',   value: 'BUSINESS_LOGIC · SCREEN_PLAN · EMBED · UI_RULES',  inline: false },
      { name: '⚙️ 개발 설정', value: 'GH_ACTIONS · SELFHOST · SQL_LOGGING · AI_CONFIG',  inline: false },
    )
    .setFooter({ text: `총 ${DOCS.length}개 문서` });

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── 셀렉트 메뉴 선택 처리 ───────────────────────────────────────────────────
async function handleSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const value = interaction.values[0];
  const doc = DOCS.find(d => d.value === value);
  if (!doc) {
    await interaction.editReply({ content: '문서를 찾을 수 없습니다.' });
    return;
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    await interaction.editReply({ content: '`CLAUDE_PROJECT_DIR` 환경변수가 없습니다.' });
    return;
  }

  const filePath = path.join(projectDir, doc.file);
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    await interaction.editReply({ content: `❌ 파일 없음: \`${doc.file}\`` });
    return;
  }

  // 스레드 생성
  let thread;
  try {
    const threadName = `📄 ${doc.label.replace(/^[\p{Emoji}\s]+/u, '').trim()}`;
    thread = await interaction.channel.threads.create({
      name: threadName.substring(0, 100),
      autoArchiveDuration: 60,
    });
  } catch (e) {
    await interaction.editReply({ content: `❌ 스레드 생성 실패: ${e.message}` });
    return;
  }

  // 스레드에 헤더 + 내용 청크 포스팅
  await thread.send(`**${doc.label}**\n\`${doc.file}\``);

  const chunks = splitIntoChunks(content);
  for (const chunk of chunks) {
    await thread.send('```md\n' + chunk + '\n```');
  }

  await interaction.editReply({
    content: `📄 스레드에서 확인하세요 → <#${thread.id}>`,
  });
}

module.exports = { execute, handleSelect };
