const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder
} = require("discord.js");

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function resolveConfig(config) {
  return {
    panelChannelId: isSnowflake(config.panelChannelId) ? config.panelChannelId : null,
    description: config.description || "Bem-vindo a WAVE. Para continuar sua estadia em nossa cidade, voce precisa liberar seu passaporte pela allowlist.",
    footerText: config.footerText || "A allowlist e feita pelo nosso site e pode ser aprovada automaticamente quando voce acertar a maioria das perguntas sobre as regras da cidade.",
    buttonLabel: config.buttonLabel || "Allowlist",
    allowlistUrl: config.allowlistUrl || "http://localhost:3000/allowlistw",
    bannerUrl: config.bannerUrl || null,
    accentColor: Number.isInteger(config.accentColor) ? config.accentColor : 0xff8c1a
  };
}

function buildAllowlistPanel(config) {
  const container = new ContainerBuilder()
    .setAccentColor(config.accentColor);

  if (config.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(config.bannerUrl)
          .setDescription("Banner da allowlist WAVE")
      )
    );
  }

  return container
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(config.description),
      new TextDisplayBuilder().setContent(config.footerText)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(config.buttonLabel)
          .setStyle(ButtonStyle.Link)
          .setURL(config.allowlistUrl)
      )
    );
}

function componentTreeHasUrl(component, url) {
  if (!component) {
    return false;
  }

  if (component.url === url) {
    return true;
  }

  if (Array.isArray(component.components)) {
    return component.components.some((child) => componentTreeHasUrl(child, url));
  }

  if (Array.isArray(component.accessory?.components)) {
    return component.accessory.components.some((child) => componentTreeHasUrl(child, url));
  }

  return false;
}

function messageHasAllowlistButton(message, config) {
  return message.components.some((component) => componentTreeHasUrl(component, config.allowlistUrl));
}

async function ensurePanel(client, config) {
  if (!config.panelChannelId) {
    console.warn("[iniciarallowlist] panelChannelId nao configurado.");
    return;
  }

  const channel = await client.channels.fetch(config.panelChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    console.warn(`[iniciarallowlist] Canal de painel invalido: ${config.panelChannelId}.`);
    return;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const existingMessage = messages?.find(
    (message) => message.author.id === client.user.id && messageHasAllowlistButton(message, config)
  );

  const payload = {
    components: [buildAllowlistPanel(config)],
    flags: MessageFlags.IsComponentsV2
  };

  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.once(Events.ClientReady, async () => {
    await ensurePanel(client, resolvedConfig).catch((error) => {
      console.error("[iniciarallowlist] Falha ao preparar painel de allowlist.", error);
    });
  });
}

module.exports = {
  register
};
