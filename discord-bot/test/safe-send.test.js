// safe-send 가드 회귀 테스트.
// 2026-04-25/26 BASE_TYPE_MAX_LENGTH 사고 재발 방지.
//
// 실행: node discord-bot/test/safe-send.test.js
// CI 도입은 추후. 지금은 push 전 수동 실행.

const assert = require('assert');
const { installSafeSendGuards, truncate, DEFAULT_LIMIT } = require('../lib/safe-send');

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

function runTests() {
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

  console.log('OK — safe-send 가드 4 케이스 PASS');
}

try {
  runTests();
  process.exit(0);
} catch (err) {
  console.error('FAIL —', err.message);
  console.error(err.stack);
  process.exit(1);
}
