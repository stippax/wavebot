const crypto = require("node:crypto");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const COMMAND_NAME = "embed";
const COMPONENT_PREFIX = "embed-builder";
const sessions = new Map();

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function parseColor(value, fallback = 0x5865f2) {
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
    .setDescription("Cria, edita, importa e exporta embeds do bot.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("criar")
        .setDescription("Abre um novo embed builder.")
        .addChannelOption((option) =>
          option
            .setName("canal")
            .setDescription("Canal onde o embed sera publicado. Padrao: canal atual.")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("editar")
        .setDescription("Edita um embed de uma mensagem enviada pelo bot.")
        .addStringOption((option) =>
          option
            .setName("mensagem")
            .setDescription("Link ou ID da mensagem do bot.")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("indice")
            .setDescription("Numero do embed na mensagem. Padrao: 1.")
            .setMinValue(1)
            .setMaxValue(10)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("importar")
        .setDescription("Abre o builder usando um arquivo JSON exportado.")
        .addAttachmentOption((option) =>
          option
            .setName("arquivo")
            .setDescription("Arquivo JSON com o embed.")
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("canal")
            .setDescription("Canal onde o embed sera publicado. Padrao: canal atual.")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("json")
        .setDescription("Exporta o JSON de um embed publicado.")
        .addStringOption((option) =>
          option
            .setName("mensagem")
            .setDescription("Link ou ID de uma mensagem publica.")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("indice")
            .setDescription("Numero do embed na mensagem. Padrao: 1.")
            .setMinValue(1)
            .setMaxValue(10)
        )
    );
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  return [{
    command: buildCommand().toJSON(),
    guildId: resolvedConfig.guildId
  }];
}

function parseMessageReference(value, interaction) {
  const input = String(value || "").trim();
  const linkMatch = input.match(/discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/i);

  if (linkMatch) {
    if (linkMatch[1] !== interaction.guildId) {
      return null;
    }

    return { channelId: linkMatch[2], messageId: linkMatch[3] };
  }

  const pairMatch = input.match(/^(\d{17,20})[\/-](\d{17,20})$/);
  if (pairMatch) {
    return { channelId: pairMatch[1], messageId: pairMatch[2] };
  }

  if (isSnowflake(input)) {
    return { channelId: interaction.channelId, messageId: input };
  }

  return null;
}

async function fetchMessage(interaction, input) {
  const reference = parseMessageReference(input, interaction);

  if (!reference) {
    return null;
  }

  const channel = interaction.guild.channels.cache.get(reference.channelId)
    || await interaction.guild.channels.fetch(reference.channelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.messages) {
    return null;
  }

  return channel.messages.fetch(reference.messageId).catch(() => null);
}

function extractEmbedData(value) {
  let candidate = value;

  if (Array.isArray(candidate)) {
    [candidate] = candidate;
  } else if (candidate && Array.isArray(candidate.embeds)) {
    [candidate] = candidate.embeds;
  } else if (candidate?.embed && typeof candidate.embed === "object") {
    candidate = candidate.embed;
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("O JSON precisa conter um objeto de embed.");
  }

  const data = new EmbedBuilder(candidate).toJSON();
  validateEmbed(data);
  return data;
}

function validateOptionalString(value, label) {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${label} precisa ser um texto.`);
  }
}

function validateOptionalUrl(value, label) {
  if (value === undefined) return;
  validateOptionalString(value, label);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} precisa ser uma URL valida.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} precisa usar http ou https.`);
  }
}

function validateEmbed(data) {
  validateOptionalString(data.title, "O titulo");
  validateOptionalString(data.description, "A descricao");
  validateOptionalString(data.author?.name, "O nome do autor");
  validateOptionalString(data.footer?.text, "O rodape");
  validateOptionalString(data.timestamp, "A data");
  validateOptionalUrl(data.url, "O link do titulo");
  validateOptionalUrl(data.author?.url, "O link do autor");
  validateOptionalUrl(data.author?.icon_url, "O icone do autor");
  validateOptionalUrl(data.footer?.icon_url, "O icone do rodape");
  validateOptionalUrl(data.image?.url, "A imagem principal");
  validateOptionalUrl(data.thumbnail?.url, "A miniatura");

  if (data.color !== undefined && (!Number.isInteger(data.color) || data.color < 0 || data.color > 0xffffff)) {
    throw new Error("A cor do embed precisa ser um numero hexadecimal valido.");
  }

  if (data.fields !== undefined && !Array.isArray(data.fields)) {
    throw new Error("Os campos do embed precisam estar em uma lista.");
  }

  const hasVisibleContent = Boolean(
    data.title
    || data.description
    || data.author?.name
    || data.footer?.text
    || data.image?.url
    || data.thumbnail?.url
    || data.fields?.length
  );

  if (!hasVisibleContent) {
    throw new Error("O embed precisa ter algum conteudo visivel.");
  }

  if (data.title?.length > 256) throw new Error("O titulo pode ter no maximo 256 caracteres.");
  if (data.description?.length > 4096) throw new Error("A descricao pode ter no maximo 4096 caracteres.");
  if (data.footer?.text?.length > 2048) throw new Error("O rodape pode ter no maximo 2048 caracteres.");
  if (data.author?.name?.length > 256) throw new Error("O autor pode ter no maximo 256 caracteres.");
  if ((data.fields?.length || 0) > 25) throw new Error("Um embed pode ter no maximo 25 campos.");

  let totalLength = (data.title?.length || 0)
    + (data.description?.length || 0)
    + (data.footer?.text?.length || 0)
    + (data.author?.name?.length || 0);

  for (const field of data.fields || []) {
    if (!field || typeof field !== "object") throw new Error("Um dos campos do embed e invalido.");
    validateOptionalString(field.name, "O nome do campo");
    validateOptionalString(field.value, "O valor do campo");
    if (field.inline !== undefined && typeof field.inline !== "boolean") {
      throw new Error("A opcao inline de um campo precisa ser true ou false.");
    }
    if (!field.name || !field.value) throw new Error("Todo campo precisa ter nome e valor.");
    if (field.name.length > 256) throw new Error("O nome de um campo passou de 256 caracteres.");
    if (field.value.length > 1024) throw new Error("O valor de um campo passou de 1024 caracteres.");
    totalLength += field.name.length + field.value.length;
  }

  if (totalLength > 6000) {
    throw new Error("O embed passou do limite total de 6000 caracteres.");
  }
}

function createSession(interaction, config, embed, options = {}) {
  const id = crypto.randomBytes(8).toString("hex");
  const session = {
    id,
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: options.channelId || interaction.channelId,
    target: options.target || null,
    embed,
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
    return { error: "Este builder expirou. Execute o comando novamente." };
  }

  if (session.ownerId !== interaction.user.id || session.guildId !== interaction.guildId) {
    return { error: "Este builder pertence a outro usuario." };
  }

  return { session };
}

function componentId(action, sessionId) {
  return `${COMPONENT_PREFIX}:${action}:${sessionId}`;
}

function parseComponentId(customId) {
  const match = customId.match(/^embed-builder:([a-z]+):([0-9a-f]{16})$/);
  return match ? { action: match[1], sessionId: match[2] } : null;
}

function builderComponents(session) {
  const saveLabel = session.target ? "Salvar alteracoes" : "Publicar";

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("content", session.id))
        .setLabel("Conteudo")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("media", session.id))
        .setLabel("Midia")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("raw", session.id))
        .setLabel("Editar JSON")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("export", session.id))
        .setLabel("Exportar JSON")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("save", session.id))
        .setLabel(saveLabel)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(componentId("close", session.id))
        .setLabel("Encerrar")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function builderPayload(session, notice) {
  const destination = session.target
    ? `Editando a mensagem ${session.target.messageUrl}`
    : `Destino: <#${session.channelId}>`;

  return {
    content: [
      "**Embed builder**",
      destination,
      notice || "Use os botoes abaixo para montar o embed. Somente voce consegue ver este painel."
    ].join("\n"),
    embeds: [new EmbedBuilder(session.embed)],
    components: builderComponents(session)
  };
}

function addTextInput(modal, { id, label, value, placeholder, style = TextInputStyle.Short, maxLength }) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(false);

  if (value) input.setValue(String(value).slice(0, maxLength || 4000));
  if (placeholder) input.setPlaceholder(placeholder);
  if (maxLength) input.setMaxLength(maxLength);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function contentModal(session) {
  const modal = new ModalBuilder()
    .setCustomId(componentId("contentform", session.id))
    .setTitle("Editar conteudo");

  addTextInput(modal, { id: "title", label: "Titulo", value: session.embed.title, maxLength: 256 });
  addTextInput(modal, {
    id: "description",
    label: "Descricao",
    value: session.embed.description,
    style: TextInputStyle.Paragraph,
    maxLength: 4000
  });
  addTextInput(modal, {
    id: "color",
    label: "Cor hexadecimal",
    value: `#${(session.embed.color || 0).toString(16).padStart(6, "0")}`,
    placeholder: "#5865f2",
    maxLength: 7
  });
  addTextInput(modal, { id: "url", label: "Link do titulo", value: session.embed.url, maxLength: 4000 });
  addTextInput(modal, {
    id: "timestamp",
    label: "Data e hora",
    value: session.embed.timestamp,
    placeholder: "agora, uma data ISO, ou deixe vazio",
    maxLength: 64
  });
  return modal;
}

function mediaModal(session) {
  const modal = new ModalBuilder()
    .setCustomId(componentId("mediaform", session.id))
    .setTitle("Editar midia e identificacao");

  addTextInput(modal, { id: "author", label: "Nome do autor", value: session.embed.author?.name, maxLength: 256 });
  addTextInput(modal, { id: "authoricon", label: "URL do icone do autor", value: session.embed.author?.icon_url, maxLength: 4000 });
  addTextInput(modal, { id: "footer", label: "Texto do rodape", value: session.embed.footer?.text, maxLength: 2048 });
  addTextInput(modal, { id: "thumbnail", label: "URL da miniatura", value: session.embed.thumbnail?.url, maxLength: 4000 });
  addTextInput(modal, { id: "image", label: "URL da imagem principal", value: session.embed.image?.url, maxLength: 4000 });
  return modal;
}

function rawModal(session) {
  const modal = new ModalBuilder()
    .setCustomId(componentId("rawform", session.id))
    .setTitle("Editar JSON do embed");
  const json = JSON.stringify(session.embed, null, 2);

  addTextInput(modal, {
    id: "json",
    label: "JSON",
    value: json.length <= 4000 ? json : "",
    placeholder: json.length > 4000 ? "O JSON atual e grande. Importe um arquivo pelo comando." : undefined,
    style: TextInputStyle.Paragraph,
    maxLength: 4000
  });
  return modal;
}

function optionalField(interaction, id) {
  const value = interaction.fields.getTextInputValue(id).trim();
  return value || undefined;
}

function updateContentFromModal(interaction, session) {
  const next = { ...session.embed };
  const title = optionalField(interaction, "title");
  const description = optionalField(interaction, "description");
  const colorInput = optionalField(interaction, "color");
  const url = optionalField(interaction, "url");
  const timestampInput = optionalField(interaction, "timestamp");

  if (title) next.title = title; else delete next.title;
  if (description) next.description = description; else delete next.description;
  if (url) next.url = url; else delete next.url;

  if (colorInput) {
    if (!/^#[0-9a-f]{6}$/i.test(colorInput)) throw new Error("Use uma cor no formato #5865f2.");
    next.color = parseColor(colorInput);
  } else {
    delete next.color;
  }

  if (timestampInput?.toLowerCase() === "agora") {
    next.timestamp = new Date().toISOString();
  } else if (timestampInput) {
    const date = new Date(timestampInput);
    if (Number.isNaN(date.getTime())) throw new Error("A data informada nao e valida.");
    next.timestamp = date.toISOString();
  } else {
    delete next.timestamp;
  }

  session.embed = new EmbedBuilder(next).toJSON();
}

function updateMediaFromModal(interaction, session) {
  const next = { ...session.embed };
  const author = optionalField(interaction, "author");
  const authorIcon = optionalField(interaction, "authoricon");
  const footer = optionalField(interaction, "footer");
  const thumbnail = optionalField(interaction, "thumbnail");
  const image = optionalField(interaction, "image");

  if (author) next.author = { name: author, ...(authorIcon ? { icon_url: authorIcon } : {}) };
  else delete next.author;
  if (footer) next.footer = { text: footer }; else delete next.footer;
  if (thumbnail) next.thumbnail = { url: thumbnail }; else delete next.thumbnail;
  if (image) next.image = { url: image }; else delete next.image;

  session.embed = new EmbedBuilder(next).toJSON();
}

function jsonAttachment(embed, filename = "embed.json") {
  const buffer = Buffer.from(`${JSON.stringify(embed, null, 2)}\n`, "utf8");
  return new AttachmentBuilder(buffer, { name: filename });
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

  return true;
}

async function resolveDestination(interaction) {
  const channel = interaction.options.getChannel("canal") || interaction.channel;

  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    await replyError(interaction, "Escolha um canal onde o bot possa enviar mensagens.");
    return null;
  }

  if (!channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ManageMessages)) {
    await replyError(interaction, "Voce precisa de Gerenciar Mensagens no canal de destino.");
    return null;
  }

  return channel;
}

async function openBuilder(interaction, config, embed) {
  const destination = await resolveDestination(interaction);
  if (!destination) return;

  const session = createSession(interaction, config, embed, { channelId: destination.id });
  await interaction.reply({ ...builderPayload(session), flags: MessageFlags.Ephemeral });
}

async function handleCreate(interaction, config) {
  await openBuilder(interaction, config, {
    description: "Novo embed",
    color: config.defaultColor
  });
}

async function handleImport(interaction, config) {
  const attachment = interaction.options.getAttachment("arquivo", true);

  if (attachment.size > 1024 * 1024) {
    await replyError(interaction, "O arquivo JSON deve ter no maximo 1 MB.");
    return;
  }

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Falha ao baixar JSON: HTTP ${response.status}`);

  let parsed;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    await replyError(interaction, "O arquivo enviado nao contem um JSON valido.");
    return;
  }

  await openBuilder(interaction, config, extractEmbedData(parsed));
}

async function handleEdit(interaction, config) {
  const message = await fetchMessage(interaction, interaction.options.getString("mensagem", true));
  const index = interaction.options.getInteger("indice") || 1;

  if (!message) {
    await replyError(interaction, "Nao encontrei essa mensagem. Use o link completo ou o ID de uma mensagem no canal atual.");
    return;
  }

  if (message.author.id !== interaction.client.user.id) {
    await replyError(interaction, "So posso editar mensagens enviadas por este bot.");
    return;
  }

  if (!message.channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ManageMessages)) {
    await replyError(interaction, "Voce precisa de Gerenciar Mensagens no canal dessa mensagem.");
    return;
  }

  const selectedEmbed = message.embeds[index - 1];
  if (!selectedEmbed) {
    await replyError(interaction, `Essa mensagem nao possui um embed no indice ${index}.`);
    return;
  }

  const session = createSession(interaction, config, selectedEmbed.toJSON(), {
    target: {
      channelId: message.channelId,
      messageId: message.id,
      messageUrl: message.url,
      index: index - 1
    }
  });

  await interaction.reply({ ...builderPayload(session), flags: MessageFlags.Ephemeral });
}

async function handleJsonCommand(interaction) {
  const message = await fetchMessage(interaction, interaction.options.getString("mensagem", true));
  const index = interaction.options.getInteger("indice") || 1;

  if (!message) {
    await replyError(interaction, "Nao encontrei essa mensagem. Use o link completo ou o ID de uma mensagem no canal atual.");
    return;
  }

  const selectedEmbed = message.embeds[index - 1];
  if (!selectedEmbed) {
    await replyError(interaction, `Essa mensagem nao possui um embed no indice ${index}.`);
    return;
  }

  const json = JSON.stringify(selectedEmbed.toJSON(), null, 2);
  await interaction.reply({
    content: json.length <= 1800 ? `\`\`\`json\n${json}\n\`\`\`` : "JSON exportado no arquivo abaixo.",
    files: [jsonAttachment(selectedEmbed.toJSON())],
    flags: MessageFlags.Ephemeral
  });
}

async function handleCommand(interaction, config) {
  if (!await ensureCommandAccess(interaction)) return;

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "criar") return handleCreate(interaction, config);
  if (subcommand === "editar") return handleEdit(interaction, config);
  if (subcommand === "importar") return handleImport(interaction, config);
  if (subcommand === "json") return handleJsonCommand(interaction);
}

async function handleSave(interaction, session) {
  validateEmbed(session.embed);

  if (session.target) {
    const channel = interaction.guild.channels.cache.get(session.target.channelId)
      || await interaction.guild.channels.fetch(session.target.channelId).catch(() => null);
    const message = channel?.isTextBased() && channel.messages
      ? await channel.messages.fetch(session.target.messageId).catch(() => null)
      : null;

    if (!message || message.author.id !== interaction.client.user.id) {
      throw new Error("A mensagem original nao existe mais ou nao pertence ao bot.");
    }

    const embeds = message.embeds.map((embed) => embed.toJSON());
    embeds[session.target.index] = session.embed;
    await message.edit({ embeds });
    await interaction.update(builderPayload(session, `Alteracoes salvas em ${message.url}.`));
    return;
  }

  const channel = interaction.guild.channels.cache.get(session.channelId)
    || await interaction.guild.channels.fetch(session.channelId).catch(() => null);

  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new Error("O canal de destino nao esta mais disponivel.");
  }

  const message = await channel.send({ embeds: [new EmbedBuilder(session.embed)] });
  await interaction.update(builderPayload(session, `Embed publicado em ${message.url}.`));
}

async function handleButton(interaction, parsed) {
  const result = getSession(interaction, parsed.sessionId);
  if (result.error) return replyError(interaction, result.error);

  const { session } = result;
  session.expiresAt = Date.now() + session.ttlMs;

  if (parsed.action === "content") return interaction.showModal(contentModal(session));
  if (parsed.action === "media") return interaction.showModal(mediaModal(session));
  if (parsed.action === "raw") return interaction.showModal(rawModal(session));

  if (parsed.action === "export") {
    await interaction.reply({
      content: "JSON exportado. Use este arquivo em `/embed importar` quando quiser reutiliza-lo.",
      files: [jsonAttachment(session.embed)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (parsed.action === "save") return handleSave(interaction, session);

  if (parsed.action === "close") {
    sessions.delete(session.id);
    await interaction.update({
      content: "Embed builder encerrado.",
      embeds: [],
      components: []
    });
  }
}

async function handleModal(interaction, parsed) {
  const result = getSession(interaction, parsed.sessionId);
  if (result.error) return replyError(interaction, result.error);

  const { session } = result;
  const previousEmbed = session.embed;

  try {
    if (parsed.action === "contentform") {
      updateContentFromModal(interaction, session);
    } else if (parsed.action === "mediaform") {
      updateMediaFromModal(interaction, session);
    } else if (parsed.action === "rawform") {
      let parsedJson;
      try {
        parsedJson = JSON.parse(interaction.fields.getTextInputValue("json"));
      } catch {
        throw new Error("O texto informado nao e um JSON valido.");
      }
      session.embed = extractEmbedData(parsedJson);
    } else {
      return;
    }

    validateEmbed(session.embed);
    session.expiresAt = Date.now() + session.ttlMs;
    await interaction.update(builderPayload(session, "Previa atualizada."));
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

      if (interaction.isButton()) {
        await handleButton(interaction, parsed);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction, parsed);
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
