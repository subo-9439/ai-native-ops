module.exports = {
  async execute(interaction, { GAME_SERVER_URL, ADMIN_API_KEY, EmbedBuilder }) {
    await interaction.deferReply();

    const res = await fetch(`${GAME_SERVER_URL}/api/v1/admin/status`, {
      headers: { 'Authorization': `Bearer ${ADMIN_API_KEY}` },
    });

    if (!res.ok) {
      await interaction.editReply(`서버 응답 오류: ${res.status}`);
      return;
    }

    const { data } = await res.json();

    const embed = new EmbedBuilder()
      .setTitle('🎮 game_project_server 상태')
      .setURL(GAME_SERVER_URL)
      .setColor(0x00AE86)
      .addFields(
        { name: '업타임', value: data.uptime || '-', inline: true },
        { name: '로비 방', value: String(data.rooms?.lobby ?? 0), inline: true },
        { name: '게임 중', value: String(data.rooms?.playing ?? 0), inline: true },
        { name: '활성 플레이어', value: String(data.activePlayers ?? 0), inline: true },
        { name: '메모리', value: `${data.memory?.used ?? '-'} / ${data.memory?.max ?? '-'}`, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
