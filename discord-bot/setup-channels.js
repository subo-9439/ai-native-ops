/**
 * 채널 메타데이터 일괄 셋업
 *
 * - 각 채널의 topic(헤더 설명) 설정
 * - 각 채널에 역할/사용법 메시지 포스팅 후 고정(pin)
 *
 * 실행: node setup-channels.js
 */

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = '1491466936863821857';
const API = 'https://discord.com/api/v10';

if (!TOKEN) { console.error('DISCORD_TOKEN 필요'); process.exit(1); }

const headers = {
  'Authorization': `Bot ${TOKEN}`,
  'Content-Type': 'application/json',
};

// ─── 채널 정의 ───────────────────────────────────────────
const CHANNELS = {
  '👔-ceo기획실': {
    topic: '👔 기획 대화 + 에이전트 디스패치. 일반 메시지=Claude와 기획 논의, ---BE---/---FE---/---AI--- 포함=병렬 작업 명령',
    pin: `# 👔 CEO 기획실

**이 채널은 프로젝트의 컨트롤 타워입니다.**

## 🎯 두 가지 모드

### 1️⃣ 대화 모드 (기본)
일반 메시지를 보내면 Claude가 **기획 어드바이저**로 응답.
- 아이디어 검토, 기술 실현 가능성, 공수 판단, 대안 제시
- 합의된 작업은 디스패치 형식으로 정리해서 제안해줌

### 2️⃣ 디스패치 모드
\`---BE---\` / \`---FE---\` / \`---AI---\` 섹션이 포함되면 각 에이전트에 **병렬 실행**.

\`\`\`
로비에 채팅 기능 추가

---BE---
WebSocket STOMP /topic/rooms/{code}/chat 구현, ChatMessage DTO 추가

---FE---
로비 화면에 채팅 위젯 추가, STOMP 구독

---AI---
(필요 없으면 이 섹션 생략)
\`\`\`

## 🧠 공용 메모리 (Cline Memory-Bank 패턴)

모든 에이전트가 매 작업 전 자동으로 읽고 갱신하는 공용 보드:
- \`docs/memory-bank/activeContext.md\` — 현재 포커스, 다음 단계
- \`docs/memory-bank/progress.md\` — 기능별 진행 상태, 이슈
- \`docs/memory-bank/decisions.md\` — CEO 결정사항 로그
- \`docs/memory-bank/systemPatterns.md\` — 코드 패턴

CEO 논의 → 결정은 \`decisions.md\`에 자동 기록되고, Dev가 이후 작업 시 참조.

## 🔄 세션 연속성

- 스레드 follow-up: 이전 대화 자동 포함
- 모든 작업 완료 시 \`docs/CHANGELOG.md\` 자동 기록
- 최근 작업 내역 자동 주입 (\`.ops/context.jsonl\`)
- 위키 (자동 로그인): \`/docs\` 명령 → 5분 일회용 SSO 링크
- 위키 직접 접속: https://admin.nolza.org/admin/wiki (admin / password)

## 💡 추천 워크플로우

1. 아이디어 던지기 → Claude와 검토
2. 합의되면 디스패치 지시문으로 정리 요청
3. 디스패치 실행 → BE/FE/AI 병렬 작업
4. 완료 결과 확인 → CHANGELOG 업데이트 자동
`,
  },

  '⚡-dev': {
    topic: '⚡ 통합 개발 에이전트. BE/FE/AI 모두 가능. 메시지 보내면 스레드 생성 + Claude 자동 실행',
    pin: `# ⚡ Dev — 통합 개발 에이전트

**이 채널에 메시지를 보내면 Claude 개발 에이전트가 자동 실행됩니다.**

## 담당 영역 (전체 프로젝트)
- **게임 서버**: \`game_project_server/\` (Spring Boot 3, Java 21, MariaDB, Redis, RabbitMQ, WebSocket/STOMP)
- **Flutter 앱**: \`game_project_app/\` (riverpod, dio, stomp_dart_client)
- **Flutter 웹**: \`game_project_web/\` (앱 모듈 재사용)
- **AI 서버**: \`game_project_ai/\` (Spring Boot + Gemini REST)
- **브랜치**: \`claude/dev\`

## 동작 방식
1. 메시지 전송 → ⏳ 반응
2. 스레드 자동 생성 (메시지 첫 80자 = 제목)
3. Claude CLI 실행 (전체 프로젝트 컨텍스트)
4. 진행 상황 실시간 스트리밍
5. 완료 시 ✅ + 결과 Embed
6. \`docs/CHANGELOG.md\`에 자동 기록

## 예시 지시
- \`/api/v1/admin/status 엔드포인트 추가\`
- \`로비 화면에 채팅 위젯 추가\`
- \`라이어 게임 단어 생성 프롬프트 최적화\`
- \`방 코드 형식을 6자리 → 8자리로 변경 (BE+FE 동시)\`

## 병렬 작업이 필요할 때
**BE/FE/AI 동시 작업**은 #ceo기획실에서 \`---BE---\` / \`---FE---\` / \`---AI---\` 섹션으로 디스패치.

## 🧠 공용 메모리 자동 활용

매 작업 시 \`docs/memory-bank/\` 의 4개 파일을 자동으로 읽고 갱신:
- \`activeContext.md\` (현재 포커스) · \`progress.md\` (진행 상태)
- \`decisions.md\` (CEO 결정) · \`systemPatterns.md\` (코드 패턴)

CEO가 이전에 내린 결정, 다른 작업의 상태를 Dev가 자동으로 인지합니다.

위키에서 확인:
- \`/docs\` 명령 → 자동 로그인 SSO 링크 (5분 일회용)
- 직접 접속: https://admin.nolza.org/admin/wiki (admin / password)

## 후속 지시
스레드 안에서 추가 메시지 → 이전 대화 컨텍스트 포함하여 재실행 (세션 연속).
`,
  },

  '💬-잡담': {
    topic: '💬 범용 채널. Claude와 자유롭게 대화하거나 작업 지시',
    pin: `# 💬 잡담 — 범용 채널

자유롭게 Claude와 대화하거나 가벼운 작업 지시.
- 질문 / 분석 / 조언
- 짧은 코드 작업
- 프로젝트 관련 고민

전문 작업은 #ceo기획실(기획), #backend-dev/#frontend-dev/#ai-dev(에이전트), #claude-dev(풀스택) 사용.
`,
  },
};

// ─── 실행 ────────────────────────────────────────────────
async function getChannels() {
  const res = await fetch(`${API}/guilds/${GUILD_ID}/channels`, { headers });
  return res.json();
}

async function updateTopic(channelId, topic) {
  const res = await fetch(`${API}/channels/${channelId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ topic }),
  });
  return res.ok;
}

async function postMessage(channelId, content) {
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
  });
  return res.json();
}

async function pinMessage(channelId, messageId) {
  const res = await fetch(`${API}/channels/${channelId}/pins/${messageId}`, {
    method: 'PUT',
    headers,
  });
  return res.ok;
}

async function getPins(channelId) {
  const res = await fetch(`${API}/channels/${channelId}/pins`, { headers });
  return res.json();
}

async function unpinMessage(channelId, messageId) {
  await fetch(`${API}/channels/${channelId}/pins/${messageId}`, {
    method: 'DELETE',
    headers,
  });
}

async function deleteMessage(channelId, messageId) {
  await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers,
  });
}

(async () => {
  const channels = await getChannels();
  const byName = Object.fromEntries(channels.map(c => [c.name, c]));

  for (const [name, def] of Object.entries(CHANNELS)) {
    const ch = byName[name];
    if (!ch) {
      console.log(`⚠️  #${name} 없음 (skip)`);
      continue;
    }

    // 1) topic 업데이트
    const topicOk = await updateTopic(ch.id, def.topic);
    console.log(`${topicOk ? '✅' : '❌'} #${name} topic`);

    // 2) 기존 봇 핀 메시지 삭제 (중복 방지)
    const pins = await getPins(ch.id);
    if (Array.isArray(pins)) {
      for (const pin of pins) {
        if (pin.author?.id === '1491430618465042433') {
          await unpinMessage(ch.id, pin.id);
          await deleteMessage(ch.id, pin.id);
        }
      }
    }

    // 3) 새 메시지 포스팅 + 핀
    const msg = await postMessage(ch.id, def.pin);
    if (msg.id) {
      await pinMessage(ch.id, msg.id);
      console.log(`✅ #${name} pin`);
    } else {
      console.log(`❌ #${name} pin 실패: ${JSON.stringify(msg)}`);
    }
  }

  console.log('\n✨ 채널 셋업 완료');
})();
