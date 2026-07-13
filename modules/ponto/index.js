const { createClient } = require("@supabase/supabase-js");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

const START_COMMAND_NAME = "bateponto";
const RANKING_COMMAND_NAME = "ranking";
const INFO_COMMAND_NAME = "ponto";
const GIVE_TIME_COMMAND_NAME = "dartempo";
const TOGGLE_BUTTON_PREFIX = "ponto:toggle:";
const FINISH_BUTTON_PREFIX = "ponto:finish:";
const DEFAULT_TABLE = "ponto_states";

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function resolveHexColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^#/, "");

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return fallback;
  }

  return Number.parseInt(normalized, 16);
}

function resolveConfig(config) {
  const allowedChannelIds = Array.isArray(config.allowedChannelIds)
    ? config.allowedChannelIds.filter(isSnowflake)
    : [];

  if (isSnowflake(config.allowedChannelId) && !allowedChannelIds.includes(config.allowedChannelId)) {
    allowedChannelIds.push(config.allowedChannelId);
  }

  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    allowedChannelIds,
    embedColor: resolveHexColor(config.embedColor, 0x57f287),
    supabaseTable: typeof config.supabaseTable === "string" && config.supabaseTable.trim()
      ? config.supabaseTable.trim()
      : process.env.PONTO_TABLE || DEFAULT_TABLE
  };
}

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function normalizeGuildState(value) {
  if (!value || typeof value !== "object") {
    return { users: {} };
  }

  return {
    users: value.users && typeof value.users === "object" ? value.users : {}
  };
}

async function loadState(storage) {
  const { data, error } = await storage.client
    .from(storage.table)
    .select("guild_id, state");

  if (error) {
    throw error;
  }

  const guilds = {};

  for (const row of data || []) {
    if (!isSnowflake(row.guild_id)) {
      continue;
    }

    guilds[row.guild_id] = normalizeGuildState(row.state);
  }

  return { guilds };
}

async function saveGuildState(storage, guildId, guildState) {
  const { error } = await storage.client
    .from(storage.table)
    .upsert({
      guild_id: guildId,
      state: normalizeGuildState(guildState)
    }, { onConflict: "guild_id" });

  if (error) {
    throw error;
  }
}

function getGuildState(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = { users: {} };
  }

  return state.guilds[guildId];
}

function getUserRecord(state, guildId, userId) {
  const guildState = getGuildState(state, guildId);

  if (!guildState.users[userId]) {
    guildState.users[userId] = {
      channels: {},
      activeSession: null
    };
  }

  if (!guildState.users[userId].channels) {
    guildState.users[userId].channels = {};
  }

  return guildState.users[userId];
}

function getChannelRecord(record, channelId) {
  if (!record.channels) {
    record.channels = {};
  }

  if (!record.channels[channelId]) {
    record.channels[channelId] = {
      totalWorkedMs: 0,
      sessionCount: 0,
      lastFinishedAt: null
    };
  }

  return record.channels[channelId];
}

function formatDuration(totalMs) {
  const safeMs = Math.max(0, Math.floor(totalMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDiscordDate(timestamp, style = "F") {
  return timestamp ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : "Nao disponivel";
}

function getWorkedMsForSession(session, now = Date.now()) {
  if (!session) {
    return 0;
  }

  const pausedMs = session.pausedTotalMs || 0;

  if (session.status === "paused" && session.pausedAt) {
    return Math.max(0, session.pausedAt - session.startedAt - pausedMs);
  }

  return Math.max(0, now - session.startedAt - pausedMs);
}

function getChannelTotalWorkedMs(record, channelId, now = Date.now()) {
  const channelRecord = getChannelRecord(record, channelId);
  const activeSessionMs = record.activeSession?.channelId === channelId
    ? getWorkedMsForSession(record.activeSession, now)
    : 0;

  return channelRecord.totalWorkedMs + activeSessionMs;
}

function getGeneralStats(record, now = Date.now()) {
  const totals = Object.values(record.channels || {}).reduce((acc, channelRecord) => ({
    totalWorkedMs: acc.totalWorkedMs + (channelRecord.totalWorkedMs || 0),
    sessionCount: acc.sessionCount + (channelRecord.sessionCount || 0),
    lastFinishedAt: Math.max(acc.lastFinishedAt, channelRecord.lastFinishedAt || 0)
  }), {
    totalWorkedMs: 0,
    sessionCount: 0,
    lastFinishedAt: 0
  });

  return {
    ...totals,
    totalWorkedMs: totals.totalWorkedMs + getWorkedMsForSession(record.activeSession, now),
    lastFinishedAt: totals.lastFinishedAt || null
  };
}

function resolveScope(interaction) {
  return interaction.options.getString("escopo") || "canal";
}

function buildActionRow(userId, isPaused) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TOGGLE_BUTTON_PREFIX}${userId}`)
      .setLabel(isPaused ? "Retomar" : "Pausar")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${FINISH_BUTTON_PREFIX}${userId}`)
      .setLabel("Finalizar")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildSessionEmbed(member, record, config) {
  const session = record.activeSession;
  const isPaused = session?.status === "paused";
  const workedMs = getWorkedMsForSession(session);
  const workedDisplay = isPaused
    ? formatDuration(workedMs)
    : formatDiscordDate(Date.now() - workedMs, "R");

  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("Ponto em andamento")
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(`${member} abriu um ponto de trabalho.`)
    .addFields(
      { name: "Status", value: isPaused ? "Pausado" : "Em andamento", inline: true },
      { name: "Inicio", value: formatDiscordDate(session.startedAt), inline: true },
      { name: "Trabalhando ha", value: workedDisplay, inline: true }
    )
    .setFooter({ text: `ID do membro: ${member.id}` })
    .setTimestamp(new Date());
}

function buildFinishedEmbed(member, channelRecord, sessionWorkedMs, config) {
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("Ponto finalizado")
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(`${member} finalizou o ponto.`)
    .addFields(
      { name: "Sessao finalizada", value: formatDuration(sessionWorkedMs), inline: true },
      { name: "Total acumulado", value: formatDuration(channelRecord.totalWorkedMs), inline: true },
      { name: "Sessoes finalizadas", value: String(channelRecord.sessionCount), inline: true },
      { name: "Finalizado em", value: formatDiscordDate(channelRecord.lastFinishedAt), inline: true }
    )
    .setFooter({ text: `ID do membro: ${member.id}` })
    .setTimestamp(new Date());
}

function buildUserInfoEmbed(member, stats, config, scopeLabel) {
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`Informacoes de ponto: ${member.user.username}`)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "Escopo", value: scopeLabel, inline: true },
      { name: "Total acumulado", value: formatDuration(stats.totalWorkedMs), inline: true },
      { name: "Sessoes finalizadas", value: String(stats.sessionCount), inline: true },
      { name: "Ultimo fechamento", value: formatDiscordDate(stats.lastFinishedAt), inline: true }
    )
    .setTimestamp(new Date());
}

function buildRankingEmbed(entries, config, scopeLabel) {
  const description = entries.length
    ? entries.map((entry, index) => `${index + 1}. <@${entry.userId}> - \`${formatDuration(entry.totalWorkedMs)}\``).join("\n")
    : "Nenhum ponto registrado ainda.";

  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`Ranking de Ponto - ${scopeLabel}`)
    .setDescription(description)
    .setTimestamp(new Date());
}

function buildStartCommand() {
  return new SlashCommandBuilder()
    .setName(START_COMMAND_NAME)
    .setDescription("Abre um ponto de trabalho.");
}

function buildRankingCommand() {
  return new SlashCommandBuilder()
    .setName(RANKING_COMMAND_NAME)
    .setDescription("Mostra rankings do sistema.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ponto")
        .setDescription("Mostra os 10 membros com mais tempo de ponto.")
        .addStringOption((option) =>
          option
            .setName("escopo")
            .setDescription("Escolha se o ranking sera deste canal ou geral.")
            .setRequired(false)
            .addChoices(
              { name: "Canal atual", value: "canal" },
              { name: "Geral", value: "geral" }
            )
        )
    );
}

function buildInfoCommand() {
  return new SlashCommandBuilder()
    .setName(INFO_COMMAND_NAME)
    .setDescription("Mostra as informacoes de ponto de um membro.")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Membro que sera consultado.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("escopo")
        .setDescription("Escolha se o tempo sera deste canal ou geral.")
        .setRequired(false)
        .addChoices(
          { name: "Canal atual", value: "canal" },
          { name: "Geral", value: "geral" }
        )
    );
}

function buildGiveTimeCommand() {
  return new SlashCommandBuilder()
    .setName(GIVE_TIME_COMMAND_NAME)
    .setDescription("Adiciona tempo manualmente ao ponto de um membro neste canal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Membro que recebera o tempo.")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("horas")
        .setDescription("Quantidade de horas para adicionar.")
        .setRequired(false)
        .setMinValue(0)
    )
    .addIntegerOption((option) =>
      option
        .setName("minutos")
        .setDescription("Quantidade de minutos para adicionar.")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(59)
    )
    .addIntegerOption((option) =>
      option
        .setName("segundos")
        .setDescription("Quantidade de segundos para adicionar.")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(59)
    );
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  return [
    buildStartCommand().toJSON(),
    buildRankingCommand().toJSON(),
    buildInfoCommand().toJSON(),
    buildGiveTimeCommand().toJSON()
  ].map((command) => ({
    command,
    guildId: resolvedConfig.guildId
  }));
}

function ensureAllowedChannel(interaction, config) {
  if (!config.allowedChannelIds.length || config.allowedChannelIds.includes(interaction.channelId)) {
    return true;
  }

  const channelList = config.allowedChannelIds.map((channelId) => `<#${channelId}>`).join(", ");

  interaction.reply({
    content: `Use este comando apenas em: ${channelList}.`,
    flags: MessageFlags.Ephemeral
  }).catch(() => {});

  return false;
}

async function persistGuildState(storage, state, guildId) {
  await saveGuildState(storage, guildId, getGuildState(state, guildId));
}

async function handleStartCommand(interaction, config, state, storage) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse comando so pode ser usado dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!ensureAllowedChannel(interaction, config)) {
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member) {
    await interaction.reply({
      content: "Nao consegui carregar seu perfil no servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const record = getUserRecord(state, interaction.guildId, interaction.user.id);

  if (record.activeSession) {
    await interaction.reply({
      content: "Voce ja tem um ponto aberto.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  record.activeSession = {
    startedAt: Date.now(),
    pausedAt: null,
    pausedTotalMs: 0,
    pauseCount: 0,
    status: "running",
    channelId: interaction.channelId,
    messageId: null
  };

  await interaction.reply({
    embeds: [buildSessionEmbed(member, record, config)],
    components: [buildActionRow(interaction.user.id, false)]
  });

  const replyMessage = await interaction.fetchReply();
  record.activeSession.messageId = replyMessage.id;
  await persistGuildState(storage, state, interaction.guildId);
}

async function handleToggleButton(interaction, state, storage, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse botao so funciona dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const userId = interaction.customId.slice(TOGGLE_BUTTON_PREFIX.length);

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: "Apenas o dono do ponto pode usar esse botao.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const record = getUserRecord(state, interaction.guildId, userId);
  const session = record.activeSession;
  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (!session || !member) {
    await interaction.reply({
      content: "Nao existe um ponto ativo valido para esse membro.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (session.status === "paused") {
    session.pausedTotalMs += Date.now() - session.pausedAt;
    session.pausedAt = null;
    session.status = "running";
  } else {
    session.pausedAt = Date.now();
    session.pauseCount += 1;
    session.status = "paused";
  }

  await persistGuildState(storage, state, interaction.guildId);

  await interaction.update({
    embeds: [buildSessionEmbed(member, record, config)],
    components: [buildActionRow(userId, session.status === "paused")]
  });
}

async function handleFinishButton(interaction, state, storage, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse botao so funciona dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const userId = interaction.customId.slice(FINISH_BUTTON_PREFIX.length);

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: "Apenas o dono do ponto pode usar esse botao.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const record = getUserRecord(state, interaction.guildId, userId);
  const session = record.activeSession;
  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (!session || !member) {
    await interaction.reply({
      content: "Nao existe um ponto ativo valido para esse membro.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (session.status === "paused" && session.pausedAt) {
    session.pausedTotalMs += Date.now() - session.pausedAt;
    session.pausedAt = null;
  }

  const sessionWorkedMs = getWorkedMsForSession({
    ...session,
    status: "finished"
  });
  const channelRecord = getChannelRecord(record, session.channelId);

  channelRecord.totalWorkedMs += sessionWorkedMs;
  channelRecord.sessionCount += 1;
  channelRecord.lastFinishedAt = Date.now();
  record.activeSession = null;
  await persistGuildState(storage, state, interaction.guildId);

  await interaction.update({
    embeds: [buildFinishedEmbed(member, channelRecord, sessionWorkedMs, config)],
    components: []
  });
}

async function handleRankingCommand(interaction, state, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse comando so pode ser usado dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const scope = resolveScope(interaction);
  const scopeLabel = scope === "geral" ? "Geral" : `Canal ${interaction.channel}`;
  const guildState = getGuildState(state, interaction.guildId);
  const entries = Object.entries(guildState.users)
    .map(([userId, record]) => ({
      userId,
      totalWorkedMs: scope === "geral"
        ? getGeneralStats(record).totalWorkedMs
        : getChannelTotalWorkedMs(record, interaction.channelId)
    }))
    .filter((entry) => entry.totalWorkedMs > 0)
    .sort((left, right) => right.totalWorkedMs - left.totalWorkedMs)
    .slice(0, 10);

  await interaction.reply({
    embeds: [buildRankingEmbed(entries, config, scopeLabel)]
  });
}

async function handleInfoCommand(interaction, state, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse comando so pode ser usado dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario") || interaction.user;
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "Nao consegui encontrar esse membro no servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const record = getUserRecord(state, interaction.guildId, targetUser.id);
  const scope = resolveScope(interaction);
  const stats = scope === "geral"
    ? getGeneralStats(record)
    : {
        ...getChannelRecord(record, interaction.channelId),
        totalWorkedMs: getChannelTotalWorkedMs(record, interaction.channelId)
      };
  const scopeLabel = scope === "geral" ? "Geral" : `${interaction.channel}`;

  await interaction.reply({
    embeds: [buildUserInfoEmbed(targetMember, stats, config, scopeLabel)]
  });
}

async function handleGiveTimeCommand(interaction, state, storage, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse comando so pode ser usado dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "Nao consegui encontrar esse membro no servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const hours = interaction.options.getInteger("horas") || 0;
  const minutes = interaction.options.getInteger("minutos") || 0;
  const seconds = interaction.options.getInteger("segundos") || 0;
  const totalMs = (((hours * 60) + minutes) * 60 + seconds) * 1000;

  if (!totalMs) {
    await interaction.reply({
      content: "Informe pelo menos um valor maior que zero em horas, minutos ou segundos.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const record = getUserRecord(state, interaction.guildId, targetUser.id);
  const channelRecord = getChannelRecord(record, interaction.channelId);
  channelRecord.totalWorkedMs += totalMs;
  channelRecord.lastFinishedAt = Date.now();
  await persistGuildState(storage, state, interaction.guildId);

  await interaction.reply({
    embeds: [buildUserInfoEmbed(targetMember, {
      ...channelRecord,
      totalWorkedMs: getChannelTotalWorkedMs(record, interaction.channelId)
    }, config, `${interaction.channel}`)],
    flags: MessageFlags.Ephemeral,
    content: `Adicionado ${formatDuration(totalMs)} ao ponto de ${targetMember} neste canal.`
  });
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);
  const clientInstance = createSupabaseClient();

  if (!clientInstance) {
    throw new Error("[ponto] Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }

  const storage = {
    client: clientInstance,
    table: resolvedConfig.supabaseTable
  };
  const state = await loadState(storage);

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === START_COMMAND_NAME) {
          await handleStartCommand(interaction, resolvedConfig, state, storage);
          return;
        }

        if (interaction.commandName === RANKING_COMMAND_NAME && interaction.options.getSubcommand() === "ponto") {
          await handleRankingCommand(interaction, state, resolvedConfig);
          return;
        }

        if (interaction.commandName === INFO_COMMAND_NAME) {
          await handleInfoCommand(interaction, state, resolvedConfig);
          return;
        }

        if (interaction.commandName === GIVE_TIME_COMMAND_NAME) {
          await handleGiveTimeCommand(interaction, state, storage, resolvedConfig);
        }

        return;
      }

      if (!interaction.isButton()) {
        return;
      }

      if (interaction.customId.startsWith(TOGGLE_BUTTON_PREFIX)) {
        await handleToggleButton(interaction, state, storage, resolvedConfig);
        return;
      }

      if (interaction.customId.startsWith(FINISH_BUTTON_PREFIX)) {
        await handleFinishButton(interaction, state, storage, resolvedConfig);
      }
    } catch (error) {
      console.error("[ponto] Falha ao processar interacao.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel concluir essa acao agora.",
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
