const {
  ActionRowBuilder,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const COMMAND_NAME = "bug";
const MODAL_CUSTOM_ID = "bug-report:submit";
const TITLE_INPUT_ID = "bug-report:title";
const DESCRIPTION_INPUT_ID = "bug-report:description";
const STEPS_INPUT_ID = "bug-report:steps";

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function parseHexColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized)
    ? Number.parseInt(normalized, 16)
    : fallback;
}

function resolveConfig(config) {
  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    logChannelId: isSnowflake(config.logChannelId) ? config.logChannelId : null,
    accentColor: parseHexColor(config.accentColor, 0xed4245),
    footerText: typeof config.footerText === "string" && config.footerText.trim()
      ? config.footerText.trim().slice(0, 2048)
      : "Encontrou outro problema? Use /bug na barra de texto para enviar um novo report."
  };
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Reporta um bug para a equipe.");
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  return [{
    command: buildCommand().toJSON(),
    guildId: resolvedConfig.guildId
  }];
}

function buildBugModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_CUSTOM_ID)
    .setTitle("Reportar bug")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(TITLE_INPUT_ID)
          .setLabel("Resumo do bug")
          .setPlaceholder("Ex: O painel de tickets nao abre")
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(120)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DESCRIPTION_INPUT_ID)
          .setLabel("O que aconteceu?")
          .setPlaceholder("Explique o erro, onde aconteceu e o que era esperado.")
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(1000)
          .setStyle(TextInputStyle.Paragraph)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(STEPS_INPUT_ID)
          .setLabel("Como reproduzir? (opcional)")
          .setPlaceholder("Ex: 1. Usei /ticket 2. Cliquei no botao 3. Nada aconteceu")
          .setRequired(false)
          .setMaxLength(1000)
          .setStyle(TextInputStyle.Paragraph)
      )
    );
}

function getTextInput(interaction, id) {
  return interaction.fields.getTextInputValue(id).trim();
}

function truncate(value, maxLength) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "Nao informado.";
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
}

async function resolveLogChannel(interaction, config) {
  if (!config.logChannelId) {
    return null;
  }

  const channel = interaction.guild.channels.cache.get(config.logChannelId)
    || await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);

  return channel?.isTextBased() && typeof channel.send === "function" ? channel : null;
}

function buildBugEmbed(interaction, config, payload) {
  return new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle("Novo bug reportado")
    .setDescription(truncate(payload.description, 1000))
    .addFields(
      { name: "Resumo", value: truncate(payload.title, 256) },
      { name: "Como reproduzir", value: truncate(payload.steps, 1000) },
      { name: "Autor", value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: true },
      { name: "Canal", value: interaction.channel ? `${interaction.channel}` : "Nao disponivel", inline: true },
      { name: "Data", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
    .setFooter({ text: config.footerText })
    .setTimestamp(new Date());
}

async function handleBugSubmit(interaction, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Use este comando dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const logChannel = await resolveLogChannel(interaction, config);

  if (!logChannel) {
    await interaction.reply({
      content: "O canal de logs de bugs ainda nao foi configurado. Avise a equipe.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const payload = {
    title: getTextInput(interaction, TITLE_INPUT_ID),
    description: getTextInput(interaction, DESCRIPTION_INPUT_ID),
    steps: getTextInput(interaction, STEPS_INPUT_ID)
  };

  await logChannel.send({
    embeds: [buildBugEmbed(interaction, config, payload)]
  });

  await interaction.reply({
    content: "Bug reportado com sucesso. Obrigado por avisar a equipe.",
    flags: MessageFlags.Ephemeral
  });
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
        await interaction.showModal(buildBugModal());
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === MODAL_CUSTOM_ID) {
        await handleBugSubmit(interaction, resolvedConfig);
      }
    } catch (error) {
      console.error("[bug-report] Falha ao processar report.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel enviar o report agora. Tente novamente em instantes.",
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    }
  });
}

module.exports = {
  register,
  getCommands
};
