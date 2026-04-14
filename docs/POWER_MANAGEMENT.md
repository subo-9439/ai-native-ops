# 전원 관리 & 24/7 운영

맥북을 로컬 서버처럼 상시 운영하기 위한 전원 설정.

## 현재 상태 (2026-04-14 기준)

| 시나리오 | 동작 |
|----------|------|
| 🟢 **화면만 꺼짐** (10분 무동작) | 서비스 정상 동작 — 시스템은 caffeinate가 깨워둠 |
| 🟢 **사용자 자리 비움** (키보드/마우스 미사용) | 서비스 정상 동작 |
| 🔴 **덮개 닫기 (clamshell)** | **슬립됨 → 서비스 중단** (의도적으로 막지 않음) |
| 🔴 **절전 모드 수동 선택** | 슬립됨 → 서비스 중단 |
| 🔴 **전원 끊김** | 중단 |

## 핵심 메커니즘: `caffeinate`

`start.sh`가 실행되면 `caffeinate -i -s -w $$`가 같이 붙어 실행됨:

- `-i` idle sleep 차단 (키보드/마우스 안 움직여도 시스템 깨어있음)
- `-s` AC 전원 시 시스템 슬립 차단
- `-w $$` 이 셸이 죽으면 caffeinate도 자동 종료 (리소스 누수 방지)
- `-d` 는 **일부러 빼둠** → 화면은 꺼지게 두어 전력 절감

`start.sh` 실행 중일 때만 유효. 셸 종료 시 caffeinate도 같이 꺼져서 맥북은 정상 슬립 가능.

## 현재 pmset 상태

```bash
pmset -g | grep -iE "sleep"
```

기대 출력:
```
 sleep          1 (sleep prevented by caffeinate, caffeinate, caffeinate, powerd)
 displaysleep  10
 disksleep     10
```

`sleep prevented by caffeinate` 라인이 보이면 OK.

## 전기세 추정 (30일 24/7)

| 맥북 | 유휴 전력 | 월 전력량 | 추가 전기세 (누진제 하단) |
|------|-----------|-----------|---------------------------|
| MacBook Air M3 + 화면 꺼둠 | ~6~10W | 5~7 kWh | ~700~1,500원 |
| MacBook Pro M3/M4 + 화면 꺼둠 | ~10~15W | 7~11 kWh | ~1,000~2,500원 |
| + 화면 계속 켜둠 | +10~20W | +7~14 kWh | +1,000~3,000원 |

비교:
- Railway 클라우드 $5/월 ≈ **7,000원**
- 맥북 24/7 운영 ≈ **월 1,000~2,500원**

약 **60~80% 저렴**.

## 의식적으로 안 하는 것

### ❌ 덮개 닫아도 동작 (clamshell mode 우회)
- 이유: 실수로 덮개 닫으면 그대로 돌아가는 게 위험 (과열/팬 소음)
- 필요하면 별도 조치: `sudo pmset -a disablesleep 1`

### ❌ Discord 명령 시 웨이크업
- 현재 구조(봇이 맥북 local)에서는 **불가능**
- 슬립 중엔 Discord Gateway WebSocket이 끊겨서 명령 도달 불가
- 이전 WoL+Cloudflare Worker 구조로 가능하지만 **월 1~2천원 아끼려고 복잡도 올리는 건 비추**
- 선택: 그냥 24/7 켜두기

### ❌ 화면 sleep 강제로 막기
- 전력의 60~70% 차지. 끄는 게 훨씬 이득
- 현재 10분 후 자동 꺼짐 (기본값)

## 변경 방법

### 화면 꺼지는 시간 변경
시스템 설정 → 잠금 화면 → "디스플레이 끄기 전 시간"

또는 터미널:
```bash
sudo pmset -c displaysleep 30   # AC 전원 시 30분
sudo pmset -c displaysleep 5    # 5분 (더 절약)
```

### caffeinate 일시 해제
```bash
pkill -f "caffeinate -i -s"
```

### `start.sh` 완전 종료
해당 터미널에서 Ctrl+C 또는:
```bash
pkill -f "project-manager/start.sh"
```
→ caffeinate도 자동 종료됨 (`-w $$` 옵션 덕분)

## 문제 진단

### "서비스가 갑자기 끊겼다"
1. `pgrep -l caffeinate` → 실행 중인지 확인
2. `pmset -g | grep sleep` → `prevented by caffeinate` 문구 있는지
3. 덮개 닫혔는지 (의도적으로 슬립 허용)
4. `curl http://127.0.0.1:4040/health` 등 개별 서비스 확인

### "맥북이 뜨겁다"
- M 시리즈는 유휴 시 거의 발열 없음
- 계속 뜨거우면 Activity Monitor에서 CPU 점유 프로세스 확인
- 필요 시 `pmset -g log | tail -100` 로그 확인

## 참고

- Apple 공식 `caffeinate(8)` 매뉴얼: `man caffeinate`
- `pmset` 매뉴얼: `man pmset`
