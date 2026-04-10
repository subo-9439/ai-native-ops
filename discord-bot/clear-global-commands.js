/**
 * 글로벌 슬래시 커맨드 전체 삭제
 * 사용법: start-local.sh 과 같은 방식으로 .env 로드 후 실행
 *   bash -c "set -a && source ../.env && set +a && node clear-global-commands.js"
 */

const { REST, Routes } = require('discord.js');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN, DISCORD_CLIENT_ID 환경변수 필요');
  process.exit(1);
}

const rest = new REST().setToken(TOKEN);

(async () => {
  try {
    console.log('[Clear] 글로벌 커맨드 목록 조회...');
    const existing = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(`[Clear] 글로벌 커맨드 ${existing.length}개 발견 → 전체 삭제`);

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log('[Clear] 글로벌 커맨드 삭제 완료 (반영까지 최대 1시간)');
    console.log('[Clear] 서버 커맨드는 그대로 유지됩니다.');
  } catch (err) {
    console.error('[Clear] 실패:', err.message);
  }
})();
