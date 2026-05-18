# 반응형 게이트 (responsive-gate)

> [PM 적용 제외] project-manager=운영 인프라(Node/스크립트), Flutter UI 없음. SSOT 일관성 위해 복제하되 본 규칙은 game(whosbuying)에만 강제.

> **rules만으로는 충분하지 않다.** 이 규칙은 모바일/웹 양쪽 검증 의무 + golden 테스트와 함께 동작한다.
> 재발 사례: 2026-05-03 폭탄박스 솔로 화면 — 웹 wide 환경에서 Stack 기본값(topStart) 때문에
> 박스 영역이 좌측 상단에 박혀 우측 절반이 비어 보임. 모바일에서는 화면 폭=박스 폭이라 안 보이던 버그.
> CEO가 "두 번 고치는 상황 반복 → 근본적으로 고쳐놔" 보고.

## 원칙

**누가살래는 모바일/태블릿/웹 wide 3개 폼팩터를 동시 지원한다.**
신규/변경되는 사용자 노출 UI는 **모든 폼팩터에서 시각적으로 검증되기 전에는 applied 금지**한다.

`B2B 임베드 = 웹` 이 SSOT(`CLAUDE.md` 제품/아키텍처 핵심)이므로, 모바일만 검증하고 웹을 빼먹는 것은
**제품 핵심 가치 위반**이다.

## 폼팩터 정의

| 폼팩터 | 너비 (logical px) | 우선순위 | 비고 |
|--------|-------------------|---------|------|
| Mobile | < 600 | 1차 | 가장 좁음. 자동 반응 잘 됨 |
| Tablet | 600 ~ 900 | 2차 | 회귀 자주 발생 |
| Web Wide | ≥ 900 | **1차 (B2B 임베드 핵심)** | 박스/카드 좌측 정렬 사고 다발 |

## 적용 대상 (필수 검증)

다음 작업에서 모바일/웹 양쪽 시각 검증을 빼먹으면 안 된다:

- 게임 PLAYING/INTRO/RESULT 화면 (bomb_box, ladder, blind_bid, liar_game, chaos_race, roulette, draw_lots, ...)
- 로비/방/랜딩 (landing, room, sub_room)
- 결과 패널, 점수 패널, 모달, 다이얼로그, 토스트
- Stack/Flex/Wrap 자식 위치를 결정짓는 alignment
- Container width/maxWidth/clamp 가 들어가는 모든 위젯
- 새 페이지 라우트, 새 위젯 클래스

## 흔한 사고 패턴 (회귀 방지 체크리스트)

1. **Stack 기본 alignment = topStart** — 자식이 부모보다 작으면 좌측 상단에 박힌다.
   `Stack(alignment: Alignment.topCenter)` 또는 `Center` 로 감싸기.
2. **Column/Row crossAxisAlignment 미지정** — 부모 폭이 자식 폭보다 클 때 좌측 정렬 발생.
   `crossAxisAlignment: CrossAxisAlignment.center` 명시.
3. **availableWidth.clamp(min, max) 패턴** — 영역을 max 로 clamp 했으면 부모에서 가운데 정렬되도록 감싸야 함.
4. **SingleChildScrollView + Column** — cross-axis 로 child 가 부모 만큼 expand 되지 않음.
   Column 의 cross 정렬을 명시적으로 center 로 잡거나 ScrollView 를 Center 로 감싸기.
5. **CrossAxisAlignment.start 가 부모 Column 에 있는데 자식이 Wide 화면 가정 없음** — game_screen 의
   `_buildBody` 자식이 좁으면 좌측 정렬돼 보임. `Center` 로 감싸기.
6. **모바일 가정 전용 hardcoded width** — `width: 320` 같이 픽셀 고정. `LayoutBuilder` 또는
   `MediaQuery.of(context).size.width` 기반 분기 필요.

## 검증 절차 (필수 3단계)

### 1. 코드 구조 self-check
- Stack 사용 시 `alignment` 명시했나?
- Column/Row 의 `crossAxisAlignment` 가 의도대로 지정됐나?
- `clamp(min, max)` 로 폭을 제한했다면 그 위젯을 `Center` 또는 `Align(alignment: ...)` 로 감쌌나?

### 2. 양쪽 폼팩터 시각 검증
- **Mobile**: `flutter run` 또는 Chrome DevTools 모바일 에뮬레이션 (375 × 812)
- **Web Wide**: `flutter run -d chrome` 후 브라우저 1400 × 900 이상으로 늘려서 확인

### 3. Golden 테스트
- `landing_web_wide`, `landing_mobile_*` 패턴(`game_project_app/test/golden/`)을 따라
  주요 게임 화면도 mobile/web wide 양쪽 golden 추가
- 회귀 시 PR 차단되도록 CI 게이트에 포함

## 답변 검증 표현

UI 코드를 변경한 답변에는 **둘 중 하나가 반드시 명시**되어야 한다:

- ✅ `반응형 검증 완료: mobile <확인 결과> / web wide <확인 결과>` (양쪽 확인 시)
- ✅ `반응형 검증: <폼팩터>만 변경, 다른 폼팩터 영향 없음 (사유)` (영향 없는 변경 시)

명시가 없으면 본 규칙을 무시한 것으로 간주한다.

## 위반 사례

| 날짜 | 위치 | 원인 | 사고 형태 |
|------|------|------|----------|
| 2026-05-03 | `bomb_box.dart` L114 | `Stack(children: [...])` alignment 미지정 → topStart 기본값 | 웹 wide 에서 박스 영역이 좌측 상단에 박힘. 우측 절반 빈 공간. |

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 | Claude 자발적 준수 + 답변 검증 표현 강제 |
| L2 — 메모리뱅크 | `decisions.md` 결정 기록 | 회귀 시 근거 추적 |
| L3 — Golden 테스트 | `test/golden/` | CI 게이트로 회귀 차단 (별 PR 로 확장 예정) |

세 계층 중 하나라도 거부하면 해당 작업은 수행하지 않는다.

## 예외

- BE/AI 서버 코드 수정: 적용 제외
- 메모리/문서/스크립트 수정: 적용 제외
- 사용자 화면에 노출되는 모든 Flutter 위젯 변경: 본 규칙 필수 적용
