module.exports = {
  async execute(interaction, { GAME_SERVER_URL, ADMIN_API_KEY, EmbedBuilder }) {
    await interaction.deferReply();

    const res = await fetch(`${GAME_SERVER_URL}/api/v1/admin/rooms`, {
      headers: { 'Authorization': `Bearer ${ADMIN_API_KEY}` },
    });

    if (!res.ok) {
      await interaction.editReply(`서버 응답 오류: ${res.status}`);
      return;
    }

    const { data: rooms } = await res.json();

    if (!rooms || rooms.length === 0) {
      await interaction.editReply('활성 방이 없습니다.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`활성 방 (${rooms.length}개)`)
      .setColor(0x5865F2)
      .setTimestamp();

    for (const room of rooms.slice(0, 10)) {
      embed.addFields({
        name: `${room.roomCode} — ${room.title}`,
        value: `상태: ${room.status} | 호스트: ${room.hostNickname} | 인원: ${room.playerCount}/${room.maxPlayers}`,
      });
    }

    if (rooms.length > 10) {
      embed.setFooter({ text: `외 ${rooms.length - 10}개 방...` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
