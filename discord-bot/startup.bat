@echo off
REM Discord Bot 자동 시작 스크립트
REM Windows Startup 폴더에 바로가기 또는 이 .bat 파일을 두면 로그인 시 자동 실행됨
REM
REM 경로: C:\Users\kws33\Desktop\projects\ai-native-ops\discord-bot\startup.bat

REM 부팅 직후 네트워크/서비스 안정 대기 (10초)
timeout /t 10 /nobreak >nul 2>&1

REM Discord Bot 실행 (별도 창으로)
start "Discord Bot - 프로젝트매니저" /MIN cmd /k "cd /d %~dp0 && bash start-local.sh"
