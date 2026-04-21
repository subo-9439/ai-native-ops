# RUNBOOK: work-queue 미적재 (큐 append 누락)

> **이 문서는 project-manager 운영봇을 사용하는 모든 프로젝트에 공통 적용되는 범용 런북이다.**
> 저장소 이름, PR ID, 게임 도메인과 무관하게 동일 규칙을 따른다. 원 사고 기록은 하단 [타임라인 (실제 사건)] 참조.

**최초 발생일**: 2026-04-20 08:00~08:43 (whosbuying/PR-FIX8)
**상태**: 설계 결함 확정 — 에이전트 프롬프트 규칙 + 봇 피드백 이중화로 대응
**심각도**: P2 (작업 지연, 데이터 손실 없음)

## 범용 규칙 (모든 프로젝트 공통)

1. **큐에 아이템을 넣는 유일한 방법은 `project-manager/work-queue.json` 직접 편집이다.** 채팅 텍스트에 `---BE---/---FE---/---AI---` 블록을 나열하거나 "큐에 적재했다"고 서술하는 것은 **큐 적재가 아니다**. 파일을 쓰지 않으면 어떤 에이전트도 작업하지 않는다.
2. **`<<START_QUEUE>>` 태그는 pick 트리거일 뿐 append 트리거가 아니다.** 태그는 이미 pending 상태로 존재하는 아이템을 `pickNext()`로 가져와 디스패치한다. pending 0이면 봇이 L3 경고 reply를 보낸 뒤 no-op 처리한다.
3. **단건 PR은 큐를 우회한다.** 1건 PR은 디스패치 채널(`#dev` 등)에 `---BE---/---FE---/---AI---` 블록을 직접 보내는 편이 가장 빠르다. 큐는 2건 이상을 순차 실행할 때만 사용한다.
4. **재발 방지는 3-layer 이중화다.** L1(에이전트 프롬프트 규칙) + L2(봇 pending 0 경고 reply) + L3(이 런북) 모두 건재해야 한다. 한 계층만 제거되면 재현된다.

## 퀵 진단 (30초, 프로젝트 무관)

```bash
# 1. 큐에 pending이 실제로 있는가
jq '[.items[] | select(.status=="pending")] | length' project-manager/work-queue.json
# 0이면 → 아래 "해결" 절 참조

# 2. 봇 프로세스 생존 여부
ps -ef | grep "node index.js" | grep -v grep

# 3. START_QUEUE 감지 로그 (최근 50줄)
tail -n 50 project-manager/work-queue.log
```

## 증상

CEO 기획실 스레드에서 에이전트가 "PR-FIX8, PR-FIX6 큐에 적재 후 순차 실행"이라고 답변하고 `<<START_QUEUE>>` 태그까지 붙였으나:

- `project-manager/work-queue.json` pending 개수: 0
- Discord 완료 embed 미도착 (40분+ 대기)
- 어떤 에이전트도 작업 시작하지 않음

## 조사 결과

1. 봇 프로세스 정상: `node index.js` PID 47782, `start.sh`/`caffeinate` 생존
2. 큐 JSON 정상: 6건 모두 `status: done`, 파일 무결성 OK
3. 태그 감지 정상: `discord-bot/index.js:280, 331`에서 `<<START_QUEUE>>` 읽음

## 근본 원인

**`<<START_QUEUE>>` 태그는 이미 `work-queue.json`에 `pending` 상태로 존재하는 아이템을 `pickNext()`로 pick만 한다. 채팅 텍스트(에이전트 답변 또는 CEO 메시지)에서 새 PR 사양을 파싱해 큐에 append하는 로직은 봇에 없다.**

증거: `discord-bot/index.js:280`
```js
if (buffer.includes('<<START_QUEUE>>') && peekNext()) {
  await handleQueueStart(thread);
}
```

`peekNext()`는 pending이 없으면 null → `handleQueueStart`도 호출 안 됨 → 사일런트 무시.

CEO 기획실 에이전트 프롬프트는 "pending 아이템이 있을 때만 태그를 붙인다"고 지시하지만, 에이전트가 이 규칙을 지키지 못하고 태그를 붙여서 사용자에게 "큐 돌아간다"는 오해를 유발했다.

## 자가 재생(Self-Recovery) 절차

### 재현 판별 (10초)

1. `cat project-manager/work-queue.json | grep -c '"status": "pending"'` — 0이면 이 이슈
2. `ps -ef | grep "node index.js" | grep -v grep` — 살아있으면 봇 정상
3. 큐에 넣고 싶은 PR이 실제로 json에 없는지 확인

### 해결 (A안: 큐 사용)

```bash
# 1. work-queue.json 직접 편집 — items 배열에 pending 아이템 append
# 2. 저장 후 CEO 기획실에서 "큐 돌려" 등으로 START_QUEUE 트리거
```

아이템 스키마:
```json
{
  "id": "PR-FIX8",
  "title": "제목",
  "agent": "flutter-ux-implementer",
  "prompt": "---FE---\n...",
  "status": "pending"
}
```

### 해결 (B안: 큐 우회, 권장)

CEO 기획실에서 단일 PR을 바로 디스패치 채널(`#dev`)로 보낸다. 큐 없이 단건 실행.

## 재발 방지

### L1 — 에이전트 프롬프트 보강 (권장, 공수 5분)

CEO 기획실 에이전트에 다음 규칙 추가:

> `<<START_QUEUE>>` 태그는 `work-queue.json`에 이미 pending 아이템이 있을 때만 붙인다. 채팅 텍스트로만 PR을 나열하는 것은 큐 적재가 아니다. 큐에 넣으려면 반드시 Bash 툴로 `work-queue.json`을 편집하라.

### L2 — 봇 기능 확장 (비권장)

채팅 텍스트에서 PR 블록 파싱 → 자동 append. 파싱 오류/악의적 입력 리스크 대비 공수 크고 이득 작음. **도입 보류**.

### L3 — 시각적 피드백

`peekNext()`가 null인데 `<<START_QUEUE>>`를 받으면 봇이 "⚠️ 큐에 pending 없음" reply 전송. 사용자가 즉시 감지 가능. 공수 10분.

## 관련 파일

- `project-manager/discord-bot/work-queue.js` — 큐 CRUD
- `project-manager/discord-bot/index.js:274-282, 326-333` — START_QUEUE 핸들러
- `project-manager/work-queue.json` — 큐 SSOT
- `project-manager/work-queue.log` — 큐 operation 로그

## 타임라인 (실제 사건)

- 07:55 CEO "고고" → PR-FIX8+PR-FIX6 나열, `<<START_QUEUE>>` 1회
- 08:00 CEO "큐돟혀" → pending 0 관측, 재적재 필요 안내
- 08:02 CEO "2번 ㄱㄱ" → 다시 `<<START_QUEUE>>` (큐에 쓰지 않고 태그만)
- 08:10 CEO "ㄱㄱㄱ" → 여전히 pending 0
- 08:12 CEO "B그리고 메모리뱅크에..." → 큐 우회 단건 디스패치 안내
- 08:43 CEO "아직도 알림이안온거보면..." → 조사 요청
- 08:50 원인 확정: 큐 append 로직 부재 = 설계 결함
