const WORKFLOW_MAP = {
  web: 'deploy-web.yml',
  server: 'deploy-server.yml',
  android: 'deploy-android.yml',
};

module.exports = {
  async execute(interaction, ctx) {
    const target = interaction.options.getString('target');
    await interaction.deferReply();

    const GITHUB_TOKEN = process.env.GITHUB_PAT;
    if (!GITHUB_TOKEN) {
      await interaction.editReply('GITHUB_PAT 환경변수가 설정되지 않았습니다.');
      return;
    }

    const workflow = WORKFLOW_MAP[target];
    if (!workflow) {
      await interaction.editReply(`알 수 없는 대상: ${target}`);
      return;
    }

    const REPO = process.env.GITHUB_REPO || 'subo-9439/whosbuying';

    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (res.status === 204) {
      await interaction.editReply(`\`${target}\` 배포 트리거 완료. GitHub Actions에서 확인하세요.`);
    } else {
      const body = await res.text();
      await interaction.editReply(`배포 트리거 실패 (${res.status}): ${body}`);
    }
  },
};
