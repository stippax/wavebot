const crypto = require("node:crypto");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");
const QRCode = require("qrcode");

const COMMAND_NAME = "pagamento";
const PIX_BUTTON_PREFIX = "payments:pix:";
const MP_BUTTON_PREFIX = "payments:mp:";
const PAYMENT_TTL_MS = 30 * 60 * 1000;

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function resolveConfig(config) {
  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    currencyId: config.currencyId || "BRL",
    defaultTitle: config.defaultTitle || "Pagamento",
    defaultDescription: config.defaultDescription || "Pagamento gerado pelo bot.",
    successUrl: config.successUrl || null,
    pendingUrl: config.pendingUrl || null,
    failureUrl: config.failureUrl || null,
    pixButtonLabel: config.pixButtonLabel || "Pix",
    cardButtonLabel: config.cardButtonLabel || "Cartao (Mercado Pago)",
    marketplaceButtonLabel: config.marketplaceButtonLabel || "Pagar com Mercado Pago",
    statementDescriptor: config.statementDescriptor || null
  };
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Gera opcoes de pagamento.")
    .addNumberOption((option) =>
      option
        .setName("valor")
        .setDescription("Valor da cobranca em reais.")
        .setMinValue(1)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("descricao")
        .setDescription("Descricao curta do pagamento.")
        .setMaxLength(120)
        .setRequired(false)
    );
}

async function registerCommand(client, config) {
  const command = buildCommand().toJSON();

  if (!client.application) {
    return;
  }

  if (config.guildId) {
    await client.application.commands.create(command, config.guildId);
    return;
  }

  await client.application.commands.create(command);
}

function buildBackUrls(config) {
  const backUrls = {};

  if (config.successUrl) {
    backUrls.success = config.successUrl;
  }

  if (config.pendingUrl) {
    backUrls.pending = config.pendingUrl;
  }

  if (config.failureUrl) {
    backUrls.failure = config.failureUrl;
  }

  return Object.keys(backUrls).length ? backUrls : undefined;
}

async function createPreference(config, amount, description, interaction) {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN nao definido.");
  }

  const payload = {
    items: [
      {
        title: config.defaultTitle,
        description,
        quantity: 1,
        currency_id: config.currencyId,
        unit_price: amount
      }
    ],
    external_reference: `discord-${interaction.guildId}-${interaction.channelId}-${Date.now()}`,
    back_urls: buildBackUrls(config),
    auto_return: config.successUrl ? "approved" : undefined,
    statement_descriptor: config.statementDescriptor || undefined
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Mercado Pago preference error: ${response.status} ${errorBody}`);
  }

  return response.json();
}

function formatCurrency(currency, amount) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency
  }).format(amount);
}

function createSession(state, payload) {
  const id = crypto.randomBytes(8).toString("hex");

  state.sessions.set(id, {
    ...payload,
    createdAt: Date.now()
  });

  return id;
}

function getSession(state, id) {
  const session = state.sessions.get(id);

  if (!session) {
    return null;
  }

  if (Date.now() - session.createdAt > PAYMENT_TTL_MS) {
    state.sessions.delete(id);
    return null;
  }

  return session;
}

function cleanupSessions(state) {
  const now = Date.now();

  for (const [id, session] of state.sessions.entries()) {
    if (now - session.createdAt > PAYMENT_TTL_MS) {
      state.sessions.delete(id);
    }
  }
}

function buildPaymentOptionsCard(config, amount, description) {
  return new ContainerBuilder()
    .setAccentColor(0x009ee3)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${config.defaultTitle}`),
          new TextDisplayBuilder().setContent("Escolha abaixo a forma de pagamento.")
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL("https://http2.mlstatic.com/frontend-assets/mp-web-navigation/ui-navigation/6.6.137/mercadopago/logo__large_plus.png")
            .setDescription("Pagamento")
        )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Valor:** ${formatCurrency(config.currencyId, amount)}`,
          `**Descricao:** ${description}`
        ].join("\n")
      )
    );
}

function buildPaymentOptionsComponents(config, sessionId, amount, description) {
  return [
    buildPaymentOptionsCard(config, amount, description).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PIX_BUTTON_PREFIX}${sessionId}`)
          .setLabel(config.pixButtonLabel)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${MP_BUTTON_PREFIX}${sessionId}`)
          .setLabel(config.cardButtonLabel)
          .setStyle(ButtonStyle.Primary)
      )
    )
  ];
}

function buildMarketplaceCard(config, amount, description, preference) {
  return new ContainerBuilder()
    .setAccentColor(0x009ee3)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("## Cartao / Mercado Pago"),
          new TextDisplayBuilder().setContent("Use o botao abaixo para abrir o checkout do Mercado Pago.")
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL("https://http2.mlstatic.com/frontend-assets/mp-web-navigation/ui-navigation/6.6.137/mercadopago/logo__large_plus.png")
            .setDescription("Mercado Pago")
        )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Valor:** ${formatCurrency(config.currencyId, amount)}`,
          `**Descricao:** ${description}`,
          `**Referencia:** ${preference.id}`
        ].join("\n")
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(config.marketplaceButtonLabel)
          .setStyle(ButtonStyle.Link)
          .setURL(preference.init_point)
      )
    );
}

function buildPixPayload(amount, description) {
  const key = process.env.PIX_KEY;
  const receiverName = process.env.PIX_RECEIVER_NAME || "HIPE STUDIO";
  const receiverCity = process.env.PIX_RECEIVER_CITY || "SAO PAULO";

  if (!key) {
    throw new Error("PIX_KEY precisa estar definido.");
  }

  const merchantName = receiverName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .slice(0, 25);
  const merchantCity = receiverCity
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .slice(0, 15);
  const txid = "HIPESTUDIO";
  const amountText = amount.toFixed(2);
  const safeDescription = (description || "Pagamento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .slice(0, 50);

  const field = (id, value) => `${id}${String(value.length).padStart(2, "0")}${value}`;
  const merchantAccount = [
    field("00", "br.gov.bcb.pix"),
    field("01", key),
    safeDescription ? field("02", safeDescription) : ""
  ].join("");

  const payloadWithoutCrc = [
    field("00", "01"),
    field("26", merchantAccount),
    field("52", "0000"),
    field("53", "986"),
    field("54", amountText),
    field("58", "BR"),
    field("59", merchantName),
    field("60", merchantCity),
    field("62", field("05", txid)),
    "6304"
  ].join("");

  const crc = crc16(payloadWithoutCrc);
  return `${payloadWithoutCrc}${crc}`;
}

function crc16(payload) {
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;

    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

async function buildPixAttachment(payload) {
  const buffer = await QRCode.toBuffer(payload, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512
  });

  return new AttachmentBuilder(buffer, { name: "pix-qrcode.png" });
}

function buildPixCard(config, amount, description, payload) {
  return new ContainerBuilder()
    .setAccentColor(0x00b386)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Pix"),
      new TextDisplayBuilder().setContent("Use o Pix copia e cola abaixo ou escaneie o QR Code no final da mensagem.")
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Valor:** ${formatCurrency(config.currencyId, amount)}`,
          `**Descricao:** ${description}`,
          "",
          "**Pix copia e cola:**",
          "```text",
          payload,
          "```"
        ].join("\n")
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL("attachment://pix-qrcode.png")
          .setDescription("QR Code Pix")
      )
    );
}

async function handlePaymentCommand(interaction, config, state) {
  const amount = interaction.options.getNumber("valor", true);
  const description = interaction.options.getString("descricao") || config.defaultDescription;
  const sessionId = createSession(state, { amount, description });

  await interaction.deferReply();
  cleanupSessions(state);

  await interaction.editReply({
    components: buildPaymentOptionsComponents(config, sessionId, amount, description),
    flags: MessageFlags.IsComponentsV2
  });
}

async function handlePixButton(interaction, config, state) {
  const sessionId = interaction.customId.slice(PIX_BUTTON_PREFIX.length);
  const session = getSession(state, sessionId);

  if (!session) {
    await interaction.reply({
      content: "Essa opcao de pagamento expirou. Gere um novo pagamento com /pagamento.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const payload = buildPixPayload(session.amount, session.description);
  const attachment = await buildPixAttachment(payload);

  await interaction.reply({
    files: [attachment],
    components: [buildPixCard(config, session.amount, session.description, payload)],
    flags: MessageFlags.IsComponentsV2
  });
}

async function handleMercadoPagoButton(interaction, config, state) {
  const sessionId = interaction.customId.slice(MP_BUTTON_PREFIX.length);
  const session = getSession(state, sessionId);

  if (!session) {
    await interaction.reply({
      content: "Essa opcao de pagamento expirou. Gere um novo pagamento com /pagamento.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply();

  const preference = await createPreference(config, session.amount, session.description, interaction);

  await interaction.editReply({
    components: [buildMarketplaceCard(config, session.amount, session.description, preference)],
    flags: MessageFlags.IsComponentsV2
  });
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);
  const state = {
    sessions: new Map()
  };

  client.once(Events.ClientReady, async () => {
    try {
      await registerCommand(client, resolvedConfig);
    } catch (error) {
      console.error("[payments] Falha ao registrar slash command.", error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
      try {
        await handlePaymentCommand(interaction, resolvedConfig, state);
      } catch (error) {
        console.error("[payments] Falha ao gerar pagamento.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel gerar o pagamento agora.",
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

        await interaction.editReply({
          content: "Nao foi possivel gerar o pagamento agora.",
          components: []
        }).catch(() => {});
      }

      return;
    }

    if (!interaction.isButton()) {
      return;
    }

    try {
      if (interaction.customId.startsWith(PIX_BUTTON_PREFIX)) {
        await handlePixButton(interaction, resolvedConfig, state);
        return;
      }

      if (interaction.customId.startsWith(MP_BUTTON_PREFIX)) {
        await handleMercadoPagoButton(interaction, resolvedConfig, state);
      }
    } catch (error) {
      console.error("[payments] Falha ao processar opcao de pagamento.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel processar essa opcao de pagamento agora.",
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      if (interaction.deferred) {
        await interaction.editReply({
          content: "Nao foi possivel processar essa opcao de pagamento agora.",
          components: []
        }).catch(() => {});
      }
    }
  });
}

module.exports = {
  register
};
