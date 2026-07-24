const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const OPEN_MODAL_CUSTOM_ID = "iniciarallowlist:open";
const SUBMIT_MODAL_CUSTOM_ID = "iniciarallowlist:submit";
const NAME_INPUT_CUSTOM_ID = "iniciarallowlist:nome";
const TOKEN_INPUT_CUSTOM_ID = "iniciarallowlist:token";

let pool = null;
let mysql = null;

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function sanitizeIdentifier(value, fallback) {
  const identifier = typeof value === "string" && value.trim() ? value.trim() : fallback;

  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Identificador MySQL invalido: ${identifier}`);
  }

  return `\`${identifier}\``;
}

function parseHexColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();

  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return fallback;
  }

  return Number.parseInt(normalized.slice(1), 16);
}

function resolveConfig(config) {
  return {
    panelChannelId: isSnowflake(config.panelChannelId) ? config.panelChannelId : null,
    description: config.description || "Bem-vindo a WAVE. Para continuar sua estadia em nossa cidade, voce precisa liberar seu passaporte pela allowlist.",
    footerText: config.footerText || "A allowlist e feita pelo nosso site e pode ser aprovada automaticamente quando voce acertar a maioria das perguntas sobre as regras da cidade.",
    buttonLabel: config.buttonLabel || "🔶 Iniciar Allowlist",
    allowlistUrl: config.allowlistUrl || "http://localhost:3000/allowlist",
    bannerUrl: config.bannerUrl || null,
    accentColor: parseHexColor(config.accentColor, 0xff8c1a),
    mysqlUrl: process.env.ALLOWLIST_MYSQL_URL || process.env.MYSQL_URL || process.env.MYSQL_CONNECTION_STRING || null,
    mysqlTable: config.mysqlTable || process.env.ALLOWLIST_MYSQL_TABLE || "accounts",
    tokenColumn: config.tokenColumn || process.env.ALLOWLIST_TOKEN_COLUMN || "Token",
    whitelistColumn: config.whitelistColumn || process.env.ALLOWLIST_WHITELIST_COLUMN || "Whitelist",
    discordColumn: config.discordColumn || process.env.ALLOWLIST_DISCORD_COLUMN || "Discord",
    idColumn: config.idColumn || process.env.ALLOWLIST_ID_COLUMN || "id"
  };
}

function getPool(config) {
  if (!config.mysqlUrl) {
    throw new Error("MYSQL_URL nao foi configurada para o modulo allowlist.");
  }

  if (!mysql) {
    try {
      mysql = require("mysql2/promise");
    } catch (error) {
      throw new Error(`Dependencia mysql2 indisponivel: ${error.message}`);
    }
  }

  if (!pool) {
    pool = mysql.createPool({
      uri: config.mysqlUrl,
      flags: ["FOUND_ROWS"]
    });
  }

  return pool;
}

function buildAllowlistUrl(config, { token, nome, id }) {
  const url = new URL(config.allowlistUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("nome", nome);
  url.searchParams.set("id", String(id));
  return url.toString();
}

function buildAllowlistModal() {
  return new ModalBuilder()
    .setCustomId(SUBMIT_MODAL_CUSTOM_ID)
    .setTitle("Iniciar Allowlist")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(NAME_INPUT_CUSTOM_ID)
          .setLabel("Nome")
          .setPlaceholder("Ex: Joao")
          .setRequired(true)
          .setMaxLength(32)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(TOKEN_INPUT_CUSTOM_ID)
          .setLabel("Token")
          .setPlaceholder("Ex: 1218343")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32)
          .setStyle(TextInputStyle.Short)
      )
    );
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
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(OPEN_MODAL_CUSTOM_ID)
      )
    );
}

function buildContinueAllowlistCard(config, { nome, token, id, url }) {
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
      new TextDisplayBuilder().setContent("## Token validado"),
      new TextDisplayBuilder().setContent(
        [
          `Ola, **${nome}**. Encontramos seu cadastro na cidade e vinculamos seu Discord ao seu passaporte.`,
          "",
          "Clique no botao abaixo para continuar sua allowlist pelo site."
        ].join("\n")
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("🔶 Continuar Allowlist")
          .setStyle(ButtonStyle.Link)
          .setURL(url)
      )
    );
}

function componentTreeHasCustomId(component, customId) {
  if (!component) {
    return false;
  }

  if (component.customId === customId || component.custom_id === customId) {
    return true;
  }

  if (Array.isArray(component.components)) {
    return component.components.some((child) => componentTreeHasCustomId(child, customId));
  }

  if (Array.isArray(component.accessory?.components)) {
    return component.accessory.components.some((child) => componentTreeHasCustomId(child, customId));
  }

  return false;
}

function messageHasAllowlistButton(message) {
  return message.components.some((component) => componentTreeHasCustomId(component, OPEN_MODAL_CUSTOM_ID));
}

async function ensurePanel(client, config) {
  if (!config.panelChannelId) {
    console.warn("[allowlist] panelChannelId nao configurado.");
    return;
  }

  const channel = await client.channels.fetch(config.panelChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    console.warn(`[allowlist] Canal de painel invalido: ${config.panelChannelId}.`);
    return;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const existingMessage = messages?.find(
    (message) => message.author.id === client.user.id && messageHasAllowlistButton(message)
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

async function findAccountByToken(config, token) {
  const table = sanitizeIdentifier(config.mysqlTable, "accounts");
  const idColumn = sanitizeIdentifier(config.idColumn, "id");
  const tokenColumn = sanitizeIdentifier(config.tokenColumn, "Token");
  const discordColumn = sanitizeIdentifier(config.discordColumn, "Discord");
  const sql = `SELECT ${idColumn} AS playerId, ${discordColumn} AS discordId FROM ${table} WHERE ${tokenColumn} = ? LIMIT 1`;
  const [rows] = await getPool(config).execute(sql, [token]);
  return rows[0] || null;
}

async function saveDiscordId(config, token, discordId) {
  const table = sanitizeIdentifier(config.mysqlTable, "accounts");
  const tokenColumn = sanitizeIdentifier(config.tokenColumn, "Token");
  const whitelistColumn = sanitizeIdentifier(config.whitelistColumn, "Whitelist");
  const discordColumn = sanitizeIdentifier(config.discordColumn, "discord");
  const sql = `UPDATE ${table} SET ${discordColumn} = ? WHERE ${tokenColumn} = ? AND ${whitelistColumn} = 0`;
  const [result] = await getPool(config).execute(sql, [discordId, token]);
  return result.affectedRows > 0;
}

async function handleAllowlistSubmit(interaction, config) {
  const nome = interaction.fields.getTextInputValue(NAME_INPUT_CUSTOM_ID).trim();
  const token = interaction.fields.getTextInputValue(TOKEN_INPUT_CUSTOM_ID).trim();

  if (!nome || !token) {
    await interaction.reply({
      content: "Nome e token sao obrigatorios.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const account = await findAccountByToken(config, token);

    if (!account) {
      await interaction.editReply("Token inexistente.");
      return;
    }

    const saved = await saveDiscordId(config, token, interaction.user.id);

    if (!saved) {
      await interaction.editReply("Este token ja foi liberado.");
      return;
    }

    const playerId = account.playerId;
    const nickname = `${nome} | ${playerId}`;
    let member = interaction.member;

    if (!member?.setNickname && interaction.guild) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    }

    if (member?.manageable) {
      await member.setNickname(nickname, "Allowlist iniciada").catch((error) => {
        console.warn("[allowlist] Falha ao renomear membro.", error);
      });
    }

    const allowlistUrl = buildAllowlistUrl(config, { token, nome, id: playerId });

    await interaction.editReply({
      components: [
        buildContinueAllowlistCard(config, {
          nome,
          token,
          id: playerId,
          url: allowlistUrl
        })
      ],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error("[allowlist] Falha ao processar token.", error);
    await interaction.editReply("Falha ao consultar o banco de dados da cidade.");
  }
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.once(Events.ClientReady, async () => {
    await ensurePanel(client, resolvedConfig).catch((error) => {
      console.error("[allowlist] Falha ao preparar painel de allowlist.", error);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId === OPEN_MODAL_CUSTOM_ID) {
      await interaction.showModal(buildAllowlistModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === SUBMIT_MODAL_CUSTOM_ID) {
      await handleAllowlistSubmit(interaction, resolvedConfig);
    }
  });
}

module.exports = {
  register
};
