const fs   = require('fs');
const path = require('path');
const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');

// ─── 게이트웨이 SSO ────────────────────────────────────────────────────────────
const GATEWAY_INTERNAL = process.env.GATEWAY_INTERNAL_URL || 'http://127.0.0.1:4000';
const GATEWAY_PUBLIC   = process.env.PUBLIC_BASE_URL      || GATEWAY_INTERNAL;
const GATEWAY_SSO_SECRET = process.env.GATEWAY_SSO_SECRET || '';

/**
 * 게이트웨이에서 SSO 토큰 URL 발급
 * @param {string} targetPath  예: '/admin/wiki' 또는 '/admin/wiki/doc/PRD'
 * @returns {Promise<string|null>}  성공 시 공개 URL, 실패 시 null
 */
async function issueSsoUrl(targetPath = '/admin/wiki') {
  try {
    const res = await fetch(`${GATEWAY_INTERNAL}/auth/sso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sso-secret': GATEWAY_SSO_SECRET,
      },
      body: JSON.stringify({ target: targetPath }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url;
  } catch (err) {
    console.error('[docs] SSO 발급 실패:', err.message);
    return null;
  }
}

const DOCS = [
  { label: '📋 PRD (프로젝트 개요/수익)',    value: 'prd',            file: 'docs/PRD.md' },
  { label: '🏗️ 아키텍처 (채널/브릿지/임베드)', value: 'architecture',  file: 'docs/ARCHITECTURE.md' },
  { label: '🎮 비즈니스 로직/테이블',        value: 'biz_logic',      file: 'docs/BUSINESS_LOGIC_AND_TABLES.md' },
  { label: '🎯 미니게임 설계',               value: 'game_design',    file: 'docs/GAME_DESIGN.md' },
  { label: '🔧 인프라 & CI/CD',              value: 'infra',          file: 'docs/INFRASTRUCTURE.md' },
  { label: '🐛 에러 추적 & 트러블슈팅',      value: 'troubleshooting', file: 'docs/TROUBLESHOOTING.md' },
  { label: '🛠️ 개발 가이드 (UI/SQL)',         value: 'dev_guide',      file: 'docs/DEV_GUIDE.md' },
  { label: '🤖 AI 도구 설정 & 연동',         value: 'ai_ops',         file: 'docs/AI_OPS.md' },
  { label: '📝 작업 로그',                   value: 'work_log',       file: 'docs/WORK_LOG.md' },
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

  // SSO URL 발급 (자동 로그인)
  const ssoUrl = await issueSsoUrl('/admin/wiki');
  const wikiLink = ssoUrl
    ? `**[🔓 위키 열기 (자동 로그인)](${ssoUrl})**\n└ 5분 내 클릭, 일회용 링크`
    : `**[위키 열기](${GATEWAY_PUBLIC}/admin/wiki)** (아이디/비번 입력 필요)`;

  const embed = new EmbedBuilder()
    .setTitle('📚 프로젝트 문서 인덱스')
    .setDescription(
      '아래 드롭다운에서 문서를 선택하면 **스레드**로 전체 내용이 올라갑니다.\n\n' +
      wikiLink
    )
    .setColor(0x5865F2)
    .addFields(
      { name: '📋 기획',   value: 'PRD · GAME_DESIGN · BUSINESS_LOGIC',         inline: false },
      { name: '🏗️ 기술',  value: 'ARCHITECTURE · INFRASTRUCTURE · DEV_GUIDE',  inline: false },
      { name: '🔧 운영',   value: 'TROUBLESHOOTING · AI_OPS · WORK_LOG',        inline: false },
    )
    .setFooter({ text: `총 ${DOCS.length}개 문서 · ${GATEWAY_PUBLIC}/admin/wiki` });

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
