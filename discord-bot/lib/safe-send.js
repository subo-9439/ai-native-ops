// Discord 메시지 content 2000자 한도 전역 가드.
// 2026-04-25/26 BASE_TYPE_MAX_LENGTH 사고가 OPS8 핫픽스(safeContent 헬퍼) 이후에도
// 누락된 send 호출에서 다시 발생함. 호출 측 일관성에 의존하면 회귀가 반복되므로
// MessagePayload.makeContent 를 단일 지점으로 패치해 모든 send/reply/edit/followUp/webhook
// 경로의 content 를 자동으로 truncate 한다.
//
// 적용 범위:
//   TextBasedChannel.send, Message.reply/edit, Interaction.reply/editReply/followUp,
//   Webhook.send 등 discord.js 내부에서 MessagePayload.create(...).resolveBody() 를
//   거치는 모든 경로. 78개 호출 사이트를 일일이 감싸지 않아도 한 번에 보장된다.

const DEFAULT_LIMIT = 1900; // Discord 한도 2000 - 안전 마진
const TRUNCATE_FOOTER = '\n…(잘림, 대시보드에서 전체 확인)';

function truncate(input, limit = DEFAULT_LIMIT) {
  if (typeof input !== 'string') return input;
  if (input.length <= limit) return input;
  const room = Math.max(0, limit - TRUNCATE_FOOTER.length);
  return input.slice(0, room) + TRUNCATE_FOOTER;
}

let installed = false;
function installSafeSendGuards({ limit = DEFAULT_LIMIT, logger = console } = {}) {
  if (installed) return false;
  const { MessagePayload } = require('discord.js');
  if (!MessagePayload?.prototype?.makeContent) {
    logger.warn?.('[safe-send] MessagePayload.makeContent 를 찾지 못함 — 가드 미설치 (degraded)');
    return false;
  }
  const orig = MessagePayload.prototype.makeContent;
  MessagePayload.prototype.makeContent = function patchedMakeContent() {
    const out = orig.call(this);
    if (typeof out === 'string' && out.length > limit) {
      logger.warn?.(`[safe-send] content ${out.length} → ${limit}자 truncate (auto-guard)`);
      return truncate(out, limit);
    }
    return out;
  };
  installed = true;
  logger.log?.(`[safe-send] MessagePayload.makeContent guarded (limit=${limit})`);
  return true;
}

module.exports = { installSafeSendGuards, truncate, DEFAULT_LIMIT };
