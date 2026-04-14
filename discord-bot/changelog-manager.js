/**
 * 변경 기록 매니저
 *
 * 디스패치/에이전트 작업 완료 후 자동으로 CHANGELOG.md에 기록
 * 날짜별 → 에이전트별로 정리
 */

const fs = require('fs');
const path = require('path');

const CHANGELOG_FILE = 'docs/CHANGELOG.md';

/**
 * 변경 기록 추가
 * @param {string} projectDir  CLAUDE_PROJECT_DIR
 * @param {object} entry
 * @param {string} entry.agent     에이전트 라벨 (🔧 BE, 🎨 FE 등)
 * @param {string} entry.task      작업 내용 (사용자 지시)
 * @param {string} entry.summary   결과 요약
 * @param {string[]} [entry.files] 변경된 파일 목록
 */
function appendChangelog(projectDir, entry) {
  if (!projectDir) return;
  const filePath = path.join(projectDir, CHANGELOG_FILE);

  try {
    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      content = '# Changelog\n\n프로젝트 변경 기록. 에이전트 작업 완료 시 자동 기록됨.\n\n';
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // 2026-04-12
    const timeStr = now.toTimeString().slice(0, 5);  // 14:30
    const dateHeader = `## ${dateStr}`;

    // 새 엔트리 생성
    const files = entry.files?.length ? `\n  - 파일: \`${entry.files.join('`, `')}\`` : '';
    const newEntry = `- **${timeStr}** ${entry.agent}: ${entry.task.split('\n')[0].substring(0, 100)}\n  - ${entry.summary.split('\n')[0].substring(0, 200)}${files}\n`;

    // 해당 날짜 헤더가 있는지 확인
    if (content.includes(dateHeader)) {
      // 기존 날짜 헤더 바로 다음에 추가
      content = content.replace(dateHeader + '\n', dateHeader + '\n\n' + newEntry);
    } else {
      // 새 날짜 헤더 + 엔트리를 최상단에 추가 (헤더 다음)
      const headerEnd = content.indexOf('\n\n', content.indexOf('# Changelog'));
      if (headerEnd !== -1) {
        content = content.slice(0, headerEnd + 2) + dateHeader + '\n\n' + newEntry + '\n' + content.slice(headerEnd + 2);
      } else {
        content += dateHeader + '\n\n' + newEntry + '\n';
      }
    }

    fs.writeFileSync(filePath, content);
    console.log(`[Changelog] 기록 추가: ${entry.agent} — ${entry.task.substring(0, 50)}`);
  } catch (err) {
    console.error('[Changelog] 기록 실패:', err.message);
  }
}

module.exports = { appendChangelog };
