[이번 작업 영역: 백엔드 game_project_server/]

[백엔드 품질 기준 — 필수]

1. **패키지 구조**: 도메인별 수직 패키지 (room/, game/, admin/, ai/). 각 도메인 안에 api/, service/, domain/, dto/, repo/, exception/, ws/, event/ 하위 구조.
2. **API 설계**: REST는 /api/v1/{도메인} 경로. 컨트롤러에 @Tag, @Operation, @ApiResponses Swagger 어노테이션 필수. 요청 DTO에 @Valid 적용.
3. **응답 래핑**: 컨트롤러는 raw 객체 또는 AppResponse를 반환. ApiResponseAdvice가 자동으로 AppResponse.ok()/okList()/okEmpty()로 래핑한다. ResponseEntity를 직접 쓸 필요 없음.
4. **에러 응답**: DomainException(errorCode, message, httpStatus)을 상속한 커스텀 예외 사용 (예: RoomNotFoundException, RoomJoinForbiddenException). ApiExceptionHandler가 AppResponse.fail(status, code, message) 형태로 변환.
5. **에러 코드 관례**: 대문자 스네이크 (GAME_NOT_FOUND, ALREADY_IN_ROOM, INVALID_STATE 등). 프론트엔드가 code 필드로 분기하므로 변경 시 클라이언트 영향 확인.
6. **게임 상태**: Redis(GameStateStore) + RedisLock으로 관리. 게임별 로직은 GameRoundHandler 인터페이스 구현체 (LadderRoundHandler, BombBoxRoundHandler, LiarGameRoundHandler, BlindBidRoundHandler).
7. **WebSocket**: STOMP 기반. ws/ 패키지에 컨트롤러, @MessageMapping 사용. RoomEventPublisher로 방/게임 이벤트 브로드캐스트.
8. **인프라**: MariaDB + Redis + RabbitMQ. docker-compose.yml로 로컬 실행. application.yml 설정 참조.
9. **커밋 메시지**: 한글 사용, 변경 이유와 내용을 간결하게. memory-bank 갱신을 같은 커밋에 포함.
10. **공통 도메인 추출**: 비슷한 책임(혼자/봇/온라인 모드, 방 만들기/입장/공유 등)이 보이면 한 도메인으로 묶어 공통 service/repository 분리. RoundHandler 인터페이스 패턴(BombDominoService, LadderService, ...)처럼 다형성 활용.
11. **연계 작업 게이트(connected-work-gate)**: 사용자 표시명/점수/상태 라벨/카운트 변경 시 입력 → 클라 → BE 저장 → BE 응답 → 표시 → 영구 저장 6단계 모두 점검. 답변에 `연계 작업 점검 완료: <영향 화면 N개>` 명시 의무.
12. **의도 추론 의무**: DEV_CONTEXT 공통 [의도 추론 의무] 섹션 강제 적용. 명세 단순 implementation 금지. "솔로 = 봇" 명세 받으면 "이름/페르소나 변경 가능성" 같은 자연스러운 변형 1~3개 답변에 같이 제시.

[작업 지시]