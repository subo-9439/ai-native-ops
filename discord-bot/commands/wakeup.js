/**
 * /wakeup 커맨드
 * Cloudflare Worker → Render.com WoL 서비스 → UDP 매직 패킷 → PC 부팅
 */

const WOL_WORKER_URL = process.env.WOL_WORKER_URL || 'https://wol-wakeup.kws3363.workers.dev';
const WOL_SECRET     = process.env.WOL_SECRET     || '';

module.exports = {
  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options?.getString('target') || 'server1';

    try {
      const res = await fetch(`${WOL_WORKER_URL}/wakeup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wol-secret': WOL_SECRET,
        },
        body: JSON.stringify({ target }),
      });

      if (res.ok) {
        await interaction.editReply(
          `🖥️ **${target} 부팅 시도!**\n` +
          '매직 패킷 전송됨. 약 30~60초 후 온라인 됩니다.\n' +
          '`/status` 로 서버 상태를 확인하세요.'
        );
      } else {
        const data = await res.json().catch(() => ({}));
        await interaction.editReply(`❌ WoL 실패: ${data.error || res.statusText}`);
      }
    } catch (err) {
      await interaction.editReply(`❌ WoL 서비스 오류: ${err.message}`);
    }
  },
};
