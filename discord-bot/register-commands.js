const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('게임 서버 상태 조회'),

  new SlashCommandBuilder()
    .setName('rooms')
    .setDescription('활성 방 목록 조회'),

  new SlashCommandBuilder()
    .setName('close-room')
    .setDescription('방 강제 종료')
    .addStringOption(opt =>
      opt.setName('code').setDescription('방 코드').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('배포 트리거')
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('배포 대상')
        .setRequired(true)
        .addChoices(
          { name: 'web', value: 'web' },
          { name: 'server', value: 'server' },
          { name: 'android', value: 'android' }
        )
    ),
  // ─── Claude 에이전트 커맨드 ──────────────────────────────
  new SlashCommandBuilder()
    .setName('claude')
    .setDescription('Claude 에이전트 실행 (현재 채널 역할 자동 적용)')
    .addStringOption(opt =>
      opt.setName('message').setDescription('실행할 명령').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('be')
    .setDescription('Backend 에이전트 실행 (Spring Boot 전담)')
    .addStringOption(opt =>
      opt.setName('message').setDescription('백엔드 작업 명령').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('fe')
    .setDescription('Frontend 에이전트 실행 (Flutter 전담)')
    .addStringOption(opt =>
      opt.setName('message').setDescription('프론트엔드 작업 명령').setRequired(true)
    ),

  // ─── 스킬 커맨드 ─────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('skill')
    .setDescription('스킬 프리셋 실행 (review / sprint / pr / test / explain)')
    .addStringOption(opt =>
      opt.setName('skill')
        .setDescription('실행할 스킬')
        .setRequired(true)
        .addChoices(
          { name: '🔍 review — 코드 리뷰',          value: 'review'  },
          { name: '📊 sprint — 스프린트 현황',        value: 'sprint'  },
          { name: '🚀 pr     — PR 생성',              value: 'pr'      },
          { name: '🧪 test   — 테스트 코드 작성',     value: 'test'    },
          { name: '📖 explain — 파일/코드 설명',      value: 'explain' },
        )
    )
    .addStringOption(opt =>
      opt.setName('target').setDescription('대상 파일/경로/제목 (선택)').setRequired(false)
    ),

  // ─── CEO 기획실 병렬 dispatch ────────────────────────────
  new SlashCommandBuilder()
    .setName('dispatch')
    .setDescription('BE/FE/AI 에이전트에 병렬 dispatch (---BE--- ---FE--- ---AI--- 섹션 구분)')
    .addStringOption(opt =>
      opt.setName('directive')
        .setDescription('지시문 (---BE--- / ---FE--- / ---AI--- 섹션 구분자로 각 역할 지정)')
        .setRequired(true)
    ),

  // ─── 문서 ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('docs')
    .setDescription('프로젝트 문서 목록 조회 및 스레드로 보기'),

  // ─── 서버 원격 부팅 ──────────────────────────────────────
  new SlashCommandBuilder()
    .setName('wakeup')
    .setDescription('🖥️ 서버 원격 부팅 (Wake-on-LAN)')
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('부팅할 서버 (기본: server1)')
        .setRequired(false)
        .addChoices(
          { name: 'server1 (Windows PC)', value: 'server1' },
          { name: 'server2 (MacBook)',    value: 'server2' },
        )
    ),
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
