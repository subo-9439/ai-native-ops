// safe-send 가드 회귀 테스트.
// 2026-04-25/26 BASE_TYPE_MAX_LENGTH 사고 재발 방지.
//
// 실행: node discord-bot/test/safe-send.test.js
// CI 도입은 추후. 지금은 push 전 수동 실행.

const assert = require('assert');
const {
  installSafeSendGuards,
  truncate,
  chunkContent,
  safeSend,
  safeReply,
  DEFAULT_LIMIT,
} = require('../lib/safe-send');

function fakeTarget() {
  return {
    client: {
      options: {
        allowedMentions: undefined,
        jsonTransformer: x => x,
        failIfNotExists: false,
        enforceNonce: false,
      },
    },
  };
}

async function runTests() {
  // 1. truncate 헬퍼 단위 검증
  assert.strictEqual(truncate('short', 100), 'short', 'short string passthrough');
  const long = 'x'.repeat(2500);
  const cut = truncate(long, DEFAULT_LIMIT);
  assert.ok(cut.length <= DEFAULT_LIMIT, `truncated length ${cut.length} <= ${DEFAULT_LIMIT}`);
  assert.ok(cut.endsWith('대시보드에서 전체 확인)'), 'truncate footer 부착');
  assert.strictEqual(truncate(undefined, 100), undefined, 'undefined passthrough');
  assert.strictEqual(truncate(null, 100), null, 'null passthrough');

  // 2. installSafeSendGuards 가 MessagePayload.makeContent 를 패치하는지
  installSafeSendGuards();
  const { MessagePayload } = require('discord.js');
  const target = fakeTarget();

  // 2-a. 한도 이하 content 는 그대로
  const okPayload = new MessagePayload(target, { content: 'hello' });
  assert.strictEqual(okPayload.makeContent(), 'hello', '한도 이하 content 통과');

  // 2-b. 한도 초과 content 는 자동 truncate
  const bigPayload = new MessagePayload(target, { content: 'a'.repeat(3000) });
  const bigOut = bigPayload.makeContent();
  assert.strictEqual(typeof bigOut, 'string', '결과가 string');
  assert.ok(bigOut.length <= DEFAULT_LIMIT, `auto-truncate ${bigOut.length} <= ${DEFAULT_LIMIT}`);
  assert.ok(bigOut.endsWith('대시보드에서 전체 확인)'), 'footer 부착');

  // 2-c. 정확히 한도일 때 통과
  const edgePayload = new MessagePayload(target, { content: 'b'.repeat(DEFAULT_LIMIT) });
  const edgeOut = edgePayload.makeContent();
  assert.strictEqual(edgeOut.length, DEFAULT_LIMIT, '한도 정확히일 때 변형 없음');

  // 2-d. 중복 install 안전
  const before = MessagePayload.prototype.makeContent;
  installSafeSendGuards();
  assert.strictEqual(MessagePayload.prototype.makeContent, before, '중복 install 무시');

  // 3. chunkContent — 줄 경계 split
  assert.deepStrictEqual(chunkContent('hello', 100), ['hello'], '한도 이하 단일 chunk');
  assert.deepStrictEqual(chunkContent(undefined, 100), [undefined], 'undefined passthrough');

  const para = (Array.from({ length: 30 }, (_, i) => `line ${i} ${'x'.repeat(80)}`)).join('\n');
  const parts = chunkContent(para, 500);
  assert.ok(parts.length >= 4, `30줄 문단이 ≥4 chunk 로 분할 (got ${parts.length})`);
  for (const p of parts) {
    assert.ok(p.length <= 500, `각 chunk ${p.length} ≤ 500`);
  }
  // 재결합 시 원본 줄을 모두 포함 (공백 normalize 후)
  const reassembled = parts.join('\n');
  for (let i = 0; i < 30; i++) {
    assert.ok(reassembled.includes(`line ${i}`), `line ${i} 보존`);
  }

  // 4. safeSend — 단일 chunk 면 send 1회, 다중 chunk 면 순차 send + 페이지 푸터
  const sentSingle = [];
  const targetSingle = { send: async (c) => { sentSingle.push(c); return { id: `m${sentSingle.length}` }; } };
  await safeSend(targetSingle, 'short content');
  assert.strictEqual(sentSingle.length, 1, 'safeSend 단일 chunk = 1회 send');
  assert.strictEqual(sentSingle[0], 'short content', '내용 보존');

  const sentMulti = [];
  const targetMulti = { send: async (c) => { sentMulti.push(c); return { id: `m${sentMulti.length}` }; } };
  const longText = (Array.from({ length: 25 }, (_, i) => `paragraph ${i} ${'y'.repeat(100)}`)).join('\n\n');
  await safeSend(targetMulti, longText, { limit: 500 });
  assert.ok(sentMulti.length >= 4, `safeSend 분할 send (got ${sentMulti.length})`);
  for (let i = 0; i < sentMulti.length; i++) {
    assert.ok(sentMulti[i].length <= 500, `chunk ${i} 길이 ${sentMulti[i].length} ≤ 500`);
    assert.ok(sentMulti[i].includes(`*(${i + 1}/${sentMulti.length})*`), `페이지 푸터 ${i + 1}/${sentMulti.length}`);
  }

  // 5. safeReply — 첫 chunk 는 reply, 나머지는 channel.send
  const repliedFirst = [];
  const channelRest = [];
  const fakeMessage = {
    reply: async (c) => { repliedFirst.push(c); return { id: 'reply1' }; },
    channel: { send: async (c) => { channelRest.push(c); return { id: `f${channelRest.length}` }; } },
  };
  await safeReply(fakeMessage, longText, { limit: 500 });
  assert.strictEqual(repliedFirst.length, 1, 'safeReply 첫 chunk = reply 1회');
  assert.ok(channelRest.length >= 3, `safeReply 나머지 ≥3 channel.send (got ${channelRest.length})`);
  assert.ok(repliedFirst[0].includes('*(1/'), '첫 chunk 페이지 푸터');

  console.log('OK — safe-send 가드 + chunk + safeSend/Reply 케이스 PASS');
}

(async () => {
  try {
    await runTests();
    process.exit(0);
  } catch (err) {
    console.error('FAIL —', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
