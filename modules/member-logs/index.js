const { EmbedBuilder, Events } = require("discord.js");

function buildEmbed({ color, title, description, member }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
}

async function sendLog(client, guild, embed, config) {
  const channelId = config.channelId;

  if (!channelId) {
    console.warn(`[member-logs] channelId nao configurado para a guild ${guild.name}.`);
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      console.warn(`[member-logs] Canal ${channelId} invalido ou nao suporta mensagens.`);
      return;
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(`[member-logs] Falha ao enviar log para o canal ${channelId}.`, error);
  }
}

async function register({ client, config }) {
  client.on(Events.GuildMemberAdd, async (member) => {
    const embed = buildEmbed({
      color: 0x57f287,
      title: "Membro entrou",
      description: `${member.user} entrou no servidor.`,
      member
    });

    await sendLog(client, member.guild, embed, config);
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const embed = buildEmbed({
      color: 0xed4245,
      title: "Membro saiu",
      description: `${member.user.tag} saiu do servidor.`,
      member
    });

    await sendLog(client, member.guild, embed, config);
  });
}

module.exports = {
  register
};
