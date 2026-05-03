const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  // ─── 게임 서버 운영 ──────────────────────────────────────
  new SlashCommandBuilder()
    .setName('game-server-status')
    .setDescription('🎮 game_project_server 상태 조회 (방 수, 활성 플레이어, 메모리)'),

  new SlashCommandBuilder()
    .setName('game-rooms')
    .setDescription('🎮 game_project_server 활성 방 목록'),

  new SlashCommandBuilder()
    .setName('close-room')
    .setDescription('🎮 게임 방 강제 종료')
    .addStringOption(opt =>
      opt.setName('code').setDescription('방 코드').setRequired(true)
    ),

  // ─── 배포 ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('🚀 GitHub Actions 배포 트리거')
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('배포 대상')
        .setRequired(true)
        .addChoices(
          { name: 'web (Flutter Web → Firebase Hosting)', value: 'web' },
          { name: 'android (APK → Firebase App Distribution)', value: 'android' }
        )
    ),

  // ─── 통합 개발 에이전트 ──────────────────────────────────
  new SlashCommandBuilder()
    .setName('dev')
    .setDescription('⚡ 통합 개발 에이전트 (BE/FE/AI 모두 가능)')
    .addStringOption(opt =>
      opt.setName('message').setDescription('작업 명령').setRequired(true)
    ),

  // ─── 스킬 커맨드 ─────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('skill')
    .setDescription('🛠️ 스킬 프리셋 실행')
    .addStringOption(opt =>
      opt.setName('skill')
        .setDescription('실행할 스킬')
        .setRequired(true)
        .addChoices(
          { name: '🔍 review — 코드 리뷰',         value: 'review'  },
          { name: '📊 sprint — 스프린트 현황',     value: 'sprint'  },
          { name: '🚀 pr     — PR 생성',           value: 'pr'      },
          { name: '🧪 test   — 테스트 코드 작성',  value: 'test'    },
          { name: '📖 explain — 파일/코드 설명',   value: 'explain' },
        )
    )
    .addStringOption(opt =>
      opt.setName('target').setDescription('대상 파일/경로/제목 (선택)').setRequired(false)
    ),

  // ─── CEO 기획실 병렬 dispatch ────────────────────────────
  new SlashCommandBuilder()
    .setName('dispatch')
    .setDescription('👔 BE/FE/AI 병렬 디스패치 (---BE---/---FE---/---AI--- 섹션, plan-check 후 승인)')
    .addStringOption(opt =>
      opt.setName('directive')
        .setDescription('---BE--- / ---FE--- / ---AI--- 섹션 구분자로 각 역할 지정')
        .setRequired(true)
    ),

  // ─── 계획 모드 (read-only) ───────────────────────────────
  new SlashCommandBuilder()
    .setName('plan')
    .setDescription('📋 계획만 수립 (코드 변경 없음, read-only)')
    .addStringOption(opt =>
      opt.setName('task')
        .setDescription('기획/검토할 작업 — 영향 파일·단계·위험·예상 시간을 양식대로 출력')
        .setRequired(true)
    ),

  // ─── 문서 ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('docs')
    .setDescription('📚 프로젝트 문서 목록 조회'),
].map(cmd => cmd.toJSON());

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // 선택: 특정 서버에만 등록

if (!TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN, DISCORD_CLIENT_ID 환경변수 필요');
  process.exit(1);
}

const rest = new REST().setToken(TOKEN);

(async () => {
  try {
    console.log(`[Register] ${commands.length}개 슬래시 명령 등록 중...`);

    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`[Register] 서버(${GUILD_ID})에 등록 완료`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('[Register] 글로벌 등록 완료 (반영까지 최대 1시간)');
    }
  } catch (error) {
    console.error('[Register] 등록 실패:', error);
  }
})();
