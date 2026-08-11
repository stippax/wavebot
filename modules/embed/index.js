const crypto = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const templates = require("./templates");

const COMMAND_NAME = "embed";
const COMPONENT_PREFIX = "embed-builder";
const sessions = new Map();

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function parseColor(value, fallback = 0x1fa1ff) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff) {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized)
    ? Number.parseInt(normalized, 16)
    : fallback;
}

function resolveConfig(config) {
  const sessionMinutes = Number(config.sessionMinutes);

  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    sessionTtlMs: Number.isFinite(sessionMinutes) && sessionMinutes > 0
      ? Math.min(sessionMinutes, 120) * 60 * 1000
      : 30 * 60 * 1000,
    defaultColor: parseColor(config.defaultColor)
  };
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Cria um embed no canal atual.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  return [{
    command: buildCommand().toJSON(),
    guildId: resolvedConfig.guildId
  }];
}

function componentId(action, sessionId) {
  return `${COMPONENT_PREFIX}:${action}:${sessionId}`;
}

function parseComponentId(customId) {
  const match = String(customId || "").match(/^embed-builder:([a-z]+):([0-9a-f]{16})$/);
  return match ? { action: match[1], sessionId: match[2] } : null;
}

function createSession(interaction, config) {
  const id = crypto.randomBytes(8).toString("hex");
  const session = {
    id,
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    messageId: null,
    embed: null,
    ttlMs: config.sessionTtlMs,
    expiresAt: Date.now() + config.sessionTtlMs
  };

  sessions.set(id, session);
  return session;
}

function getSession(interaction, sessionId) {
  const session = sessions.get(sessionId);

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return { error: "Este editor expirou. Use /embed novamente." };
  }

  if (session.ownerId !== interaction.user.id || session.guildId !== interaction.guildId) {
    return { error: "Este editor pertence a outro usuario." };
  }

  session.expiresAt = Date.now() + session.ttlMs;
  return { session };
}

function cleanEmbed(data) {
  const embed = { ...data };

  if (!embed.title) delete embed.title;
  if (!embed.url) delete embed.url;
  if (!embed.description) delete embed.description;
  if (!embed.author?.name) delete embed.author;
  if (!embed.thumbnail?.url) delete embed.thumbnail;
  if (!embed.image?.url) delete embed.image;
  if (!embed.fields?.length) delete embed.fields;
  if (!embed.footer?.text) delete embed.footer;
  if (!embed.timestamp) delete embed.timestamp;
  if (!Number.isInteger(embed.color)) delete embed.color;

  return embed;
}

function createBlankEmbed(config) {
  return {
    color: config.defaultColor,
    title: "Novo embed",
    description: "Edite este texto usando os botoes abaixo."
  };
}

function createEmbedFromTemplate(config, template) {
  const embed = {
    color: config.defaultColor,
    ...template.embed
  };

  if (embed.timestamp === "agora") {
    embed.timestamp = new Date().toISOString();
  }

  return embed;
}

function getTemplateOptions() {
  const seen = new Set();

  return templates
    .filter((template) => {
      if (!template?.id || seen.has(template.id)) {
        return false;
      }

      seen.add(template.id);
      return true;
    })
    .slice(0, 24)
    .map((template) => ({
      label: String(template.label || template.id).slice(0, 100),
      description: String(template.description || "Usar este template.").slice(0, 100),
      value: String(template.id).slice(0, 100)
    }));
}

function selectPayload(session) {
  const embed = new EmbedBuilder()
    .setColor(0x1fa1ff)
    .setTitle("Criador de Embed")
    .setDescription("Selecione uma opcao abaixo para comecar.");

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(componentId("select", session.id))
          .setPlaceholder("Escolha um template")
          .addOptions(
            {
              label: "Criar Novo",
              description: "Comecar com um embed limpo.",
              value: "blank"
            },
            ...getTemplateOptions()
          )
      )
    ]
  };
}

function editorComponents(session) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("color", session.id))
        .setLabel("Cor")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(componentId("title", session.id))
        .setLabel("Titulo")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(componentId("description", session.id))
        .setLabel("Descricao")
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("author", session.id))
        .setLabel("Autor")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("thumbnail", session.id))
        .setLabel("Thumbnail")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("image", session.id))
        .setLabel("Imagem")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("footer", session.id))
        .setLabel("Rodape")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("url", session.id))
        .setLabel("Link")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("fields", session.id))
        .setLabel("Campos")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("timestamp", session.id))
        .setLabel("Timestamp")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("cancel", session.id))
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(componentId("submit", session.id))
        .setLabel("Enviar")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function editorPayload(session) {
  return {
    embeds: [new EmbedBuilder(cleanEmbed(session.embed))],
    components: editorComponents(session)
  };
}

function validateUrl(value, label) {
  if (!value) {
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} precisa ser uma URL valida.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} precisa usar http ou https.`);
  }

  return value;
}

function parseFields(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, 25).map((line) => {
    const [name, fieldValue, inlineValue] = line.split("|").map((part) => part.trim());

    if (!name || !fieldValue) {
      throw new Error("Use o formato: Nome | Valor | true.");
    }

    return {
      name: name.slice(0, 256),
      value: fieldValue.slice(0, 1024),
      inline: inlineValue?.toLowerCase() === "true"
    };
  });
}

function parseTimestamp(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return null;
  }

  if (normalized.toLowerCase() === "agora") {
    return new Date().toISOString();
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Timestamp invalido. Use 'agora' ou uma data ISO.");
  }

  return date.toISOString();
}

function createInput({ id, label, value, placeholder, style = TextInputStyle.Short, maxLength, required = false }) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);

  if (value) input.setValue(String(value).slice(0, maxLength || 4000));
  if (placeholder) input.setPlaceholder(placeholder);
  if (maxLength) input.setMaxLength(maxLength);

  return new ActionRowBuilder().addComponents(input);
}

function editModal(action, session) {
  const modal = new ModalBuilder()
    .setCustomId(componentId(`${action}form`, session.id));

  if (action === "color") {
    return modal
      .setTitle("Editar cor")
      .addComponents(createInput({
        id: "color",
        label: "Cor hexadecimal",
        value: `#${(session.embed.color || 0).toString(16).padStart(6, "0")}`,
        placeholder: "#1fa1ff",
        maxLength: 7,
        required: true
      }));
  }

  if (action === "title") {
    return modal
      .setTitle("Editar titulo")
      .addComponents(createInput({
        id: "title",
        label: "Titulo",
        value: session.embed.title,
        maxLength: 256
      }));
  }

  if (action === "url") {
    return modal
      .setTitle("Editar link do titulo")
      .addComponents(createInput({
        id: "url",
        label: "URL do titulo",
        value: session.embed.url,
        placeholder: "https://...",
        maxLength: 4000
      }));
  }

  if (action === "description") {
    return modal
      .setTitle("Editar descricao")
      .addComponents(createInput({
        id: "description",
        label: "Descricao",
        value: session.embed.description,
        style: TextInputStyle.Paragraph,
        maxLength: 4000
      }));
  }

  if (action === "author") {
    return modal
      .setTitle("Editar autor")
      .addComponents(
        createInput({
          id: "author",
          label: "Nome do autor",
          value: session.embed.author?.name,
          maxLength: 256
        }),
        createInput({
          id: "authoricon",
          label: "URL do icone do autor",
          value: session.embed.author?.icon_url,
          placeholder: "https://...",
          maxLength: 4000
        }),
        createInput({
          id: "authorurl",
          label: "URL do autor",
          value: session.embed.author?.url,
          placeholder: "https://...",
          maxLength: 4000
        })
      );
  }

  if (action === "thumbnail") {
    return modal
      .setTitle("Editar thumbnail")
      .addComponents(createInput({
        id: "thumbnail",
        label: "URL da thumbnail",
        value: session.embed.thumbnail?.url,
        placeholder: "https://...",
        maxLength: 4000
      }));
  }

  if (action === "image") {
    return modal
      .setTitle("Editar imagem")
      .addComponents(createInput({
        id: "image",
        label: "URL da imagem",
        value: session.embed.image?.url,
        placeholder: "https://...",
        maxLength: 4000
      }));
  }

  if (action === "footer") {
    return modal
      .setTitle("Editar rodape")
      .addComponents(
        createInput({
          id: "footer",
          label: "Rodape",
          value: session.embed.footer?.text,
          maxLength: 2048
        }),
        createInput({
          id: "footericon",
          label: "URL do icone do rodape",
          value: session.embed.footer?.icon_url,
          placeholder: "https://...",
          maxLength: 4000
        })
      );
  }

  if (action === "fields") {
    const fields = (session.embed.fields || [])
      .map((field) => `${field.name} | ${field.value} | ${field.inline ? "true" : "false"}`)
      .join("\n");

    return modal
      .setTitle("Editar campos")
      .addComponents(createInput({
        id: "fields",
        label: "Campos",
        value: fields,
        placeholder: "Nome | Valor | true\nOutro nome | Outro valor | false",
        style: TextInputStyle.Paragraph,
        maxLength: 4000
      }));
  }

  return modal
    .setTitle("Editar timestamp")
    .addComponents(createInput({
      id: "timestamp",
      label: "Timestamp",
      value: session.embed.timestamp,
      placeholder: "agora, 2026-08-11T14:00:00.000Z ou vazio",
      maxLength: 64
    }));
}

async function replyError(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

async function ensureCommandAccess(interaction) {
  if (!interaction.inGuild()) {
    await replyError(interaction, "Este comando so pode ser usado dentro de um servidor.");
    return false;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await replyError(interaction, "Voce precisa da permissao Gerenciar Mensagens para usar este comando.");
    return false;
  }

  if (!interaction.channel?.isTextBased() || typeof interaction.channel.send !== "function") {
    await replyError(interaction, "Use este comando em um canal onde o bot possa enviar mensagens.");
    return false;
  }

  return true;
}

async function handleCommand(interaction, config) {
  if (!await ensureCommandAccess(interaction)) {
    return;
  }

  const session = createSession(interaction, config);
  await interaction.reply(selectPayload(session));

  const message = await interaction.fetchReply();
  session.messageId = message.id;
}

async function handleSelect(interaction, config, session) {
  const choice = interaction.values[0];
  const template = templates.find((item) => item.id === choice);

  session.embed = template
    ? createEmbedFromTemplate(config, template)
    : createBlankEmbed(config);

  await interaction.update(editorPayload(session));
}

async function handleButton(interaction, session, action) {
  if (!session.embed && action !== "cancel") {
    await replyError(interaction, "Selecione um template antes de editar.");
    return;
  }

  if (["author", "color", "title", "url", "description", "thumbnail", "image", "footer", "fields", "timestamp"].includes(action)) {
    await interaction.showModal(editModal(action, session));
    return;
  }

  if (action === "cancel") {
    sessions.delete(session.id);
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
    return;
  }

  if (action === "submit") {
    sessions.delete(session.id);
    await interaction.update({
      embeds: [new EmbedBuilder(cleanEmbed(session.embed))],
      components: []
    });
  }
}

async function handleModal(interaction, session, action) {
  const previousEmbed = { ...session.embed };

  try {
    if (action === "colorform") {
      const value = interaction.fields.getTextInputValue("color").trim();
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Use uma cor no formato #1fa1ff.");
      session.embed.color = parseColor(value);
    } else if (action === "titleform") {
      const value = interaction.fields.getTextInputValue("title").trim();
      if (value) session.embed.title = value; else delete session.embed.title;
    } else if (action === "urlform") {
      const value = validateUrl(interaction.fields.getTextInputValue("url").trim(), "O link do titulo");
      if (value) session.embed.url = value; else delete session.embed.url;
    } else if (action === "descriptionform") {
      const value = interaction.fields.getTextInputValue("description").trim();
      if (value) session.embed.description = value; else delete session.embed.description;
    } else if (action === "authorform") {
      const name = interaction.fields.getTextInputValue("author").trim();
      const iconUrl = validateUrl(interaction.fields.getTextInputValue("authoricon").trim(), "O icone do autor");
      const authorUrl = validateUrl(interaction.fields.getTextInputValue("authorurl").trim(), "O link do autor");
      if (name) {
        session.embed.author = {
          name,
          ...(iconUrl ? { icon_url: iconUrl } : {}),
          ...(authorUrl ? { url: authorUrl } : {})
        };
      } else {
        delete session.embed.author;
      }
    } else if (action === "thumbnailform") {
      const value = validateUrl(interaction.fields.getTextInputValue("thumbnail").trim(), "A thumbnail");
      if (value) session.embed.thumbnail = { url: value }; else delete session.embed.thumbnail;
    } else if (action === "imageform") {
      const value = validateUrl(interaction.fields.getTextInputValue("image").trim(), "A imagem");
      if (value) session.embed.image = { url: value }; else delete session.embed.image;
    } else if (action === "footerform") {
      const text = interaction.fields.getTextInputValue("footer").trim();
      const iconUrl = validateUrl(interaction.fields.getTextInputValue("footericon").trim(), "O icone do rodape");
      if (text) {
        session.embed.footer = {
          text,
          ...(iconUrl ? { icon_url: iconUrl } : {})
        };
      } else {
        delete session.embed.footer;
      }
    } else if (action === "fieldsform") {
      const fields = parseFields(interaction.fields.getTextInputValue("fields"));
      if (fields.length) session.embed.fields = fields; else delete session.embed.fields;
    } else if (action === "timestampform") {
      const timestamp = parseTimestamp(interaction.fields.getTextInputValue("timestamp"));
      if (timestamp) session.embed.timestamp = timestamp; else delete session.embed.timestamp;
    } else {
      return;
    }

    await interaction.update(editorPayload(session));
  } catch (error) {
    session.embed = previousEmbed;
    await replyError(interaction, error.message);
  }
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
  }, 5 * 60 * 1000);
  cleanupTimer.unref();

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
        await handleCommand(interaction, resolvedConfig);
        return;
      }

      const parsed = parseComponentId(interaction.customId || "");
      if (!parsed) return;

      const result = getSession(interaction, parsed.sessionId);
      if (result.error) {
        await replyError(interaction, result.error);
        return;
      }

      if (interaction.isStringSelectMenu() && parsed.action === "select") {
        await handleSelect(interaction, resolvedConfig, result.session);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction, result.session, parsed.action);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction, result.session, parsed.action);
      }
    } catch (error) {
      console.error("[embed] Falha ao processar interacao.", error);
      await replyError(interaction, `Nao foi possivel concluir esta acao: ${error.message}`);
    }
  });
}

module.exports = {
  register,
  getCommands
};
