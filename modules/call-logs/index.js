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

function resolveBannerUrl(config) {
  return typeof config.bannerUrl === "string" && config.bannerUrl.trim()
    ? config.bannerUrl.trim()
    : null;
}

function resolveSettings(config) {
  return {
    logChannelId: typeof config.logChannelId === "string" && config.logChannelId.trim()
      ? config.logChannelId.trim()
      : null,
    ignoreBots: config.ignoreBots !== false,
    logMoves: config.logMoves !== false,
    bannerUrl: resolveBannerUrl(config)
  };
}

function formatChannel(channel) {
  return channel ? `<#${channel.id}>` : "Nao disponivel";
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

  container
    .addSectionComponents(headerSection)
    .addSeparatorComponents(new SeparatorBuilder());

  if (bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerUrl)
      )
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(details.join("\n"))
  );

  return container;
}

async function sendLog(client, guild, component, settings) {
  if (!settings.logChannelId) {
    console.warn(`[call-logs] logChannelId nao configurado para a guild ${guild.name}.`);
    return;
  }

  try {
    const channel = client.channels.cache.get(settings.logChannelId)
      || await client.channels.fetch(settings.logChannelId);

    if (!channel || !channel.isTextBased()) {
      console.warn(`[call-logs] Canal ${settings.logChannelId} invalido ou sem suporte a mensagens.`);
      return;
    }

    await channel.send({
      components: [component],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error(`[call-logs] Falha ao enviar log para o canal ${settings.logChannelId}.`, error);
  }
}

function buildJoinPayload(member, channel, settings) {
  return buildLogCard({
    accentColor: 0x57f287,
    heading: "Entrada em call",
    summary: `**${member.user.tag}** entrou da call: **${channel.name}**`,
    details: [
      `**Usuario:** ${member.user.tag}`,
      `**ID:** ${member.id}`,
      `**Canal:** ${formatChannel(channel)}`,
      `**Entrou em:** ${formatDate(new Date())}`
    ],
    member,
    bannerUrl: settings.bannerUrl
  });
}

function buildLeavePayload(member, channel, settings) {
  return buildLogCard({
    accentColor: 0xed4245,
    heading: "Saida de call",
    summary: `**${member.user.tag}** saiu da call: **${channel.name}**`,
    details: [
      `**Usuario:** ${member.user.tag}`,
      `**ID:** ${member.id}`,
      `**Canal:** ${formatChannel(channel)}`,
      `**Saiu em:** ${formatDate(new Date())}`
    ],
    member,
    bannerUrl: settings.bannerUrl
  });
}

function buildMovePayload(member, oldChannel, newChannel, settings) {
  return buildLogCard({
    accentColor: 0xfee75c,
    heading: "Mudanca de call",
    summary: `${member.user} trocou de call no servidor **${member.guild.name}**.`,
    details: [
      `**Usuario:** ${member.user.tag}`,
      `**ID:** ${member.id}`,
      `**Saiu de:** ${formatChannel(oldChannel)}`,
      `**Entrou em:** ${formatChannel(newChannel)}`,
      `**Movido em:** ${formatDate(new Date())}`
    ],
    member,
    bannerUrl: settings.bannerUrl
  });
}

async function register({ client, config }) {
  const settings = resolveSettings(config);

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (oldState.channelId === newState.channelId) {
      return;
    }

    const member = newState.member || oldState.member;

    if (!member) {
      return;
    }

    if (settings.ignoreBots && member.user?.bot) {
      return;
    }

    if (!oldState.channelId && newState.channel) {
      await sendLog(client, member.guild, buildJoinPayload(member, newState.channel, settings), settings);
      return;
    }

    if (oldState.channel && !newState.channelId) {
      await sendLog(client, member.guild, buildLeavePayload(member, oldState.channel, settings), settings);
      return;
    }

    if (oldState.channel && newState.channel && settings.logMoves) {
      await sendLog(
        client,
        member.guild,
        buildMovePayload(member, oldState.channel, newState.channel, settings),
        settings
      );
    }
  });
}

module.exports = {
  register
};
