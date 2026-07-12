const {
  ContainerBuilder,
  Events,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");

function formatDate(value) {
  return value ? `<t:${Math.floor(value.getTime() / 1000)}:F>` : "Nao disponivel";
}

function buildLogCard({ accentColor, heading, summary, details, member, bannerUrl }) {
  const avatarUrl = member.user.displayAvatarURL({ size: 256 });
  const container = new ContainerBuilder().setAccentColor(accentColor);

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${heading}`),
      new TextDisplayBuilder().setContent(summary)
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(avatarUrl)
        .setDescription(`Avatar de ${member.user.tag}`)
    );

  const detailsBlock = new TextDisplayBuilder().setContent(details.join("\n"));

  container
    .addSectionComponents(headerSection)
    .addSeparatorComponents(new SeparatorBuilder());

  if (bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(bannerUrl)
      )
    );
  }

  container.addTextDisplayComponents(detailsBlock);

  return container;
}

function resolveBannerUrl(config) {
  return typeof config.bannerUrl === "string" && config.bannerUrl.trim()
    ? config.bannerUrl.trim()
    : null;
}

function resolveChannelId(config, type) {
  return type === "join" ? config.joinChannelId : config.leaveChannelId;
}

async function sendLog(client, guild, component, config, type) {
  const channelId = resolveChannelId(config, type);

  if (!channelId) {
    console.warn(`[member-logs] ${type}ChannelId nao configurado para a guild ${guild.name}.`);
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      console.warn(`[member-logs] Canal ${channelId} invalido ou nao suporta mensagens.`);
      return;
    }

    await channel.send({
      components: [component],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error(`[member-logs] Falha ao enviar log para o canal ${channelId}.`, error);
  }
}

async function register({ client, config }) {
  const bannerUrl = resolveBannerUrl(config);

  client.on(Events.GuildMemberAdd, async (member) => {
    const component = buildLogCard({
      accentColor: 0x57f287,
      heading: "Entrada registrada",
      summary: `${member.user} acabou de entrar no servidor **${member.guild.name}**.`,
      details: [
        `**Usuario:** ${member.user.tag}`,
        `**ID:** ${member.id}`,
        `**Conta criada em:** ${formatDate(member.user.createdAt)}`,
        `**Entrou em:** ${formatDate(new Date())}`
      ],
      member,
      bannerUrl
    });

    await sendLog(client, member.guild, component, config, "join");
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const component = buildLogCard({
      accentColor: 0xed4245,
      heading: "Saida registrada",
      summary: `**${member.user.tag}** acabou de sair do servidor **${member.guild.name}**.`,
      details: [
        `**Usuario:** ${member.user.tag}`,
        `**ID:** ${member.id}`,
        `**Conta criada em:** ${formatDate(member.user.createdAt)}`,
        `**Saiu em:** ${formatDate(new Date())}`
      ],
      member,
      bannerUrl
    });

    await sendLog(client, member.guild, component, config, "leave");
  });
}

module.exports = {
  register
};
