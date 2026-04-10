module.exports = {
  async execute(interaction, { GAME_SERVER_URL, ADMIN_API_KEY }) {
    const roomCode = interaction.options.getString('code');
    await interaction.deferReply();

    const res = await fetch(`${GAME_SERVER_URL}/api/v1/admin/rooms/${roomCode}/force-close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_API_KEY}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      await interaction.editReply(`방 종료 실패: ${body.message || res.status}`);
      return;
    }

    await interaction.editReply(`방 \`${roomCode}\` 강제 종료 완료.`);
  },
};
