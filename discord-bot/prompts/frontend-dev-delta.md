[이번 작업 영역: 프론트엔드 game_project_app/, game_project_web/]

[UI/UX 품질 기준 — 필수]
작업 전 docs/DESIGN_SYSTEM.md를 반드시 읽는다. 이 문서가 UI 구현의 SSOT다.

1. **디자인 토큰 강제**: 색상/타이포/스페이싱은 반드시 DesignTokens 상수만 사용. 하드코딩된 Color(0xFF...), fontSize, EdgeInsets 숫자 리터럴 금지.
2. **시각적 계층**: 화면에 displaySmall(제목) → headlineMedium(섹션) → bodyMedium(본문) → labelMedium(캡션) 계층이 명확해야 한다.
3. **여백 설계**: 콘텐츠를 빽빽하게 채우지 않는다. 섹션 간 spacing6(24px) 이상, 화면 가장자리 spacing4(16px) 이상.
4. **애니메이션**: 화면 진입 시 FadeTransition+SlideTransition(200~300ms), 버튼 피드백 AnimatedContainer(150ms), 로딩 시 Shimmer 적용. 의미 없는 장식 애니메이션 금지.
5. **컴포넌트 재사용**: AppButton.primary/tonal/outline, AppSnackBar, EmptyStateView 등 기존 공통 위젯을 반드시 먼저 확인하고 사용.
6. **반응형**: 기본 모바일(360px), 웹은 ConstrainedBox(maxWidth: 600)으로 컨텐츠 제한.
7. **빈 상태/에러 상태**: 데이터가 없거나 에러일 때의 화면도 반드시 구현. EmptyStateView 패턴 사용.
8. **게임 화면**: ladder_neon_tokens.dart의 네온 테마 사용. 일반 화면과 시각적으로 구분.
9. **기존 mockup 참조**: docs/mockups/ 에 HTML 프로토타입이 있다. 새 화면의 시각적 톤을 맞춘다.
10. **에셋 워크플로(asset-first-gate)**: 이모지/즉석 SVG 추가 전 `assets/icons/`, `web/`, `.local-docs/claude_design_dump/` 검색 필수. 매칭 없을 때만 fallback. 답변에 `에셋 검색 완료: <경로> 사용` 또는 `매칭 없음, fallback` 명시 의무.
11. **게임 애니메이션 reference**: 폭탄박스(다크 spotlight + 캐릭터 glow + 박스 펄스 + 원형 카운트다운 게이지 / PR-POLISH1), 사다리(네온 cyan/pink/yellow + glow / ladder_neon_tokens.dart), 결과 화면(suspense + elasticOut + 떨어지는 컨페티 + 오렌지 glow / PR-POLISH2) 패턴 우선 차용.
12. **DoD 7항목 의무(polish-pass-gate)**: UI/UX 변경은 DoD 7항목 통과해야 완료. 답변에 `고도화 검증 완료: 3초 룰 ✓ / 시각 계층 ✓ / 피드백 ✓ / 반응형 ✓ / 회귀 ✓ / dead code ✓ / verify ✓` 한 줄 명시 의무. "작동하면 완료" 패턴 거부.
13. **반응형 게이트(responsive-gate)**: Stack alignment / Column crossAxisAlignment / clamp 후 Center 감싸기 self-check. 답변에 `반응형 검증 완료: mobile <결과> / web wide <결과>` 명시.
14. **공통 위젯 추출 우선**: 비슷한 책임 위젯이 2번 이상 반복되면 즉시 추출(game_round_result_shell.dart 같은 패턴). 신규 클래스 추가 전 기존 검색 필수.

[작업 지시]