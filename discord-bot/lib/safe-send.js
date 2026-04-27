// Discord 메시지 content 2000자 한도 전역 가드.
// 2026-04-25/26 BASE_TYPE_MAX_LENGTH 사고가 OPS8 핫픽스(safeContent 헬퍼) 이후에도
// 누락된 send 호출에서 다시 발생함. 호출 측 일관성에 의존하면 회귀가 반복되므로
// MessagePayload.makeContent 를 단일 지점으로 패치해 모든 send/reply/edit/followUp/webhook
// 경로의 content 를 최후 안전망으로 truncate 한다.
//
// 단, 가드의 truncate 는 정보 손실이라 길이 위험이 있는 사이트(queueSummary,
// 체이닝 알림, CEO 어드바이저 reply 등)는 safeSend/safeReply 를 사용해
// 줄/문단 경계로 split 하여 순차 send 한다.

const DEFAULT_LIMIT = 1900; // Discord 한도 2000 - 안전 마진
const TRUNCATE_FOOTER = '\n…(잘림, 대시보드에서 전체 확인)';
const PAGE_FOOTER_RESERVE = 12; // " *(NN/NN)*" 페이지 푸터 자리

function truncate(input, limit = DEFAULT_LIMIT) {
  if (typeof input !== 'string') return input;
  if (input.length <= limit) return input;
  const room = Math.max(0, limit - TRUNCATE_FOOTER.length);
  return input.slice(0, room) + TRUNCATE_FOOTER;
}

// content 를 한도 이하 chunk 들로 분할.
// 줄 경계(\n\n → \n → ' ') 를 우선 시도하고, 실패 시 hard cut.
function chunkContent(input, limit = DEFAULT_LIMIT) {
  if (typeof input !== 'string') return [input];
  const room = Math.max(64, limit - PAGE_FOOTER_RESERVE);
  if (input.length <= room) return [input];

  const chunks = [];
  let remaining = input;
  while (remaining.length > room) {
    const window = remaining.slice(0, room);
    let cut = window.lastIndexOf('\n\n');
    if (cut < room * 0.5) cut = window.lastIndexOf('\n');
    if (cut < room * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = room;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).replace(/^\s+/, '');
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

// chunk 에 페이지 푸터 부착. 단일 chunk 면 원본 그대로.
function withPageFooter(chunks) {
  if (chunks.length <= 1) return chunks;
  return chunks.map((c, i) => `${c}\n*(${i + 1}/${chunks.length})*`);
}

// target.send(content) 를 안전하게 split. 첫 chunk 결과를 반환(기존 send 시그니처 호환).
async function safeSend(target, content, { limit = DEFAULT_LIMIT } = {}) {
  if (typeof content !== 'string') return target.send(content);
  const pages = withPageFooter(chunkContent(content, limit));
  let first;
  for (let i = 0; i < pages.length; i++) {
    const m = await target.send(pages[i]);
    if (i === 0) first = m;
  }
  return first;
}

// message.reply 전용. 첫 chunk 만 reply, 나머지는 같은 채널 send.
async function safeReply(message, content, { limit = DEFAULT_LIMIT } = {}) {
  if (typeof content !== 'string') return message.reply(content);
  const pages = withPageFooter(chunkContent(content, limit));
  const first = await message.reply(pages[0]);
  for (let i = 1; i < pages.length; i++) {
    await message.channel.send(pages[i]);
  }
  return first;
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
      logger.warn?.(`[safe-send] content ${out.length} → ${limit}자 truncate (auto-guard, split 헬퍼 사용 권장)`);
      return truncate(out, limit);
    }
    return out;
  };
  installed = true;
  logger.log?.(`[safe-send] MessagePayload.makeContent guarded (limit=${limit})`);
  return true;
}

module.exports = {
  installSafeSendGuards,
  truncate,
  chunkContent,
  safeSend,
  safeReply,
  DEFAULT_LIMIT,
};
