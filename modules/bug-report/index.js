const {
  EmbedBuilder,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require("discord.js");

const COMMAND_NAME = "bug";

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
    accentColor: parseHexColor(config.accentColor, 0x1fa1ff),
    footerText: typeof config.footerText === "string" && config.footerText.trim()
      ? config.footerText.trim().slice(0, 2048)
      : "Para reportar outro problema, use **/bug** na barra de texto."
  };
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Reporta um bug para a equipe.")
    .addStringOption((option) =>
      option
        .setName("causa")
        .setDescription("Descreva o bug encontrado.")
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(1000)
    );
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  return [{
    command: buildCommand().toJSON(),
    guildId: resolvedConfig.guildId
  }];
}

function truncate(value, maxLength) {
  const normalized = String(value || "").trim();

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

function buildBugEmbed(interaction, config, cause) {
  return new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle("🌊 BUG REPORTADO")
    .setDescription(truncate(cause, 1000))
    .addFields(
      { name: "Enviado por", value: `${interaction.user}`, inline: true },
      { name: "Data", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setFooter({ text: config.footerText });
}

async function handleBugCommand(interaction, config) {
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
      content: "O canal de logs de bugs ainda nao foi configurado.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const cause = interaction.options.getString("causa", true);

  await logChannel.send({
    embeds: [buildBugEmbed(interaction, config, cause)]
  });

  await interaction.reply({
    content: "Bug reportado com sucesso.",
    flags: MessageFlags.Ephemeral
  });
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
        await handleBugCommand(interaction, resolvedConfig);
      }
    } catch (error) {
      console.error("[bug-report] Falha ao processar report.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel enviar o report agora.",
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
