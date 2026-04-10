/**
 * 봇 프로필 업데이트 스크립트
 * 사용법:
 *   set -a && source ../.env && set +a
 *   node update-bot-profile.js
 *
 * 아바타 이미지: 이 파일과 같은 폴더에 bot-avatar.png 파일을 놓아주세요.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('DISCORD_TOKEN 환경변수가 필요합니다.');
  process.exit(1);
}

const AVATAR_PATH = path.join(__dirname, 'bot-avatar.png');

function updateProfile(avatarDataUri) {
  const body = JSON.stringify({
    username: '프로젝트매니저',
    ...(avatarDataUri ? { avatar: avatarDataUri } : {}),
  });

  const options = {
    hostname: 'discord.com',
    path: '/api/v10/users/@me',
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${TOKEN}`,
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        const user = JSON.parse(data);
        console.log(`✅ 업데이트 완료!`);
        console.log(`   이름: ${user.username}`);
        console.log(`   아바타: ${user.avatar ? '변경됨' : '변경 안됨'}`);
      } else {
        console.error(`❌ 실패 (HTTP ${res.statusCode}):`, data);
        if (res.statusCode === 429) {
          const retry = JSON.parse(data).retry_after;
          console.error(`   Rate limit — ${retry}초 후 재시도`);
        }
      }
    });
  });

  req.on('error', err => console.error('요청 오류:', err));
  req.write(body);
  req.end();
}

// 아바타 파일이 있으면 base64로 인코딩, 없으면 이름만 변경
if (fs.existsSync(AVATAR_PATH)) {
  const imgBuffer = fs.readFileSync(AVATAR_PATH);
  const ext = path.extname(AVATAR_PATH).slice(1).replace('jpg', 'jpeg');
  const dataUri = `data:image/${ext};base64,${imgBuffer.toString('base64')}`;
  console.log(`🖼  아바타 파일 발견: bot-avatar.png (${(imgBuffer.length / 1024).toFixed(1)}KB)`);
  updateProfile(dataUri);
} else {
  console.log('⚠️  bot-avatar.png 없음 — 이름만 변경합니다.');
  console.log('   귀여운 이미지를 bot-avatar.png 로 저장 후 다시 실행하면 아바타도 바뀝니다.');
  updateProfile(null);
}
