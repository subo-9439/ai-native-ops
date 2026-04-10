const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const CHANNEL_ID = '1491475306626678895';

client.once('clientReady', async () => {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const msg = `━━━━━━━━━━━━━━━━━━━━━━━
📢 **봇 업데이트 공지** (2026-04-09)
━━━━━━━━━━━━━━━━━━━━━━━

**🤖 봇 프로필 변경**
• 이름: \`whosbuying-bot\` → **프로젝트매니저**
• 아바타: 귀여운 민트색 로봇으로 변경 완료

**🖥️ /wakeup — PC 원격 부팅 (Wake-on-LAN) 추가**
\`/wakeup\` 커맨드로 꺼진 PC를 원격으로 켤 수 있습니다.

구조:
\`\`\`
Discord /wakeup
  → Cloudflare Worker (wol-wakeup.kws3363.workers.dev)
  → Render.com WoL 서비스 (UDP 중계)
  → ipTIME 공유기 포트포워딩
  → PC (192.168.0.4) 부팅!
\`\`\`

⚠️ **수동 설정 필요 (아직 미완):**
1. BIOS → Power On By PCI-E 활성화 (재부팅 후 DEL/F2)
2. ipTIME(192.168.0.1) → 포트포워드 → UDP 9번 → 192.168.0.4:9
3. Render.com에 \`wol-service/\` 배포 후 URL을 Cloudflare Worker 환경변수에 등록
4. 자세한 설정: \`docs/WOL_PC_REMOTE_BOOT.md\` 참고

**🧠 /claude 명령 라우팅 개선**
• 기존: 채널 이름 기준으로 BE/FE 에이전트 선택
• 변경: **메시지 내용 키워드 분석**으로 자동 라우팅
  - spring/백엔드/서버/api 등 → 백엔드 에이전트
  - flutter/dart/화면/ui 등 → 프론트 에이전트
  - 애매하면 → 풀스택 에이전트

**🔗 슬래시 커맨드 중복 제거**
• 글로벌 등록되어 있던 커맨드 전체 삭제
• 길드(서버) 전용 등록만 유지 → 더이상 명령어 두 번 뜨지 않음

**🌐 cloudflared 감시 예정**
이전 공지에서 언급된 cloudflared 터널 자동 재시작 감시 기능은
현재 설정 완료 예정 상태입니다. 추후 cron watchdog 스크립트로 안정화 예정.

━━━━━━━━━━━━━━━━━━━━━━━`;

  await channel.send(msg);
  console.log('공지 전송 완료');
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
