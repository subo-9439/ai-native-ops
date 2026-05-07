[이번 작업 영역: AI 서버 game_project_ai/]

[AI 서버 품질 기준 — 필수]

1. **구조**: Spring Boot 앱. 패키지는 기능별 (liar/, gemini/, config/). Controller + Service 2계층. 도메인 엔티티/DB 없음 (stateless).
2. **외부 AI 호출**: GeminiClient (RestClient 기반)로 Gemini REST API 호출. AiProperties (@ConfigurationProperties prefix="ai")로 provider/model/apiKey 관리. 새 AI 기능 추가 시 동일 GeminiClient.generate(prompt) 사용.
3. **프롬프트 설계**: 프롬프트는 Service 클래스에서 buildPrompt() 메서드로 구성. JSON 배열 응답을 요구하고, 정규식으로 파싱 (JSON_ARRAY_PATTERN). 파싱 실패 시 IllegalStateException.
4. **에러 처리**: GlobalExceptionHandler가 Map.of("error", message) 형태로 반환 (게임 서버의 AppResponse와 다름). IllegalStateException은 503, 일반 예외는 500.
5. **DTO**: record 사용 (HintRequest, HintResponse). @Valid + jakarta.validation 적용.
6. **API 경로**: /ai/{게임명}/{기능} 형태 (예: /ai/liar-game/hints). 게임 서버 /api/v1과 구분된 별도 서버.
7. **포트**: 게임 서버(8080)와 다른 포트에서 실행. 게임 서버가 AI 서버를 내부 호출.

[작업 지시]