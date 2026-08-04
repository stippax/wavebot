const { createClient } = require("@supabase/supabase-js");
const {
  ContainerBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");

const DEFAULT_COMMAND_NAME = "punicao";
const REMOVE_COMMAND_NAME = "removerpunicao";
const PUNISHMENTS_TABLE = "bot_punishments";
const DEFAULT_EXPIRATION_DAYS = 7;
const DEFAULT_CHECK_INTERVAL_MINUTES = 60;
const DEFAULT_LEVELS = ["ADV1", "ADV2", "ADV3"];
const DEFAULT_REASONS = [
  { key: "insubordinacao", label: "Insubordinacao" },
  { key: "desrespeito", label: "Desrespeito" },
  { key: "ausencia", label: "Ausencia sem justificativa" },
  { key: "conduta", label: "Conduta inadequada" },
  { key: "procedimento", label: "Descumprimento de procedimento" }
];

const memberLocks = new Set();

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function normalizeCommandName(value) {
  const normalized = String(value || DEFAULT_COMMAND_NAME)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized && normalized.length <= 32 ? normalized : DEFAULT_COMMAND_NAME;
}

function normalizeReasonKey(value, index) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  return normalized || `motivo-${index + 1}`;
}

function resolveLevels(config) {
  const configured = Array.isArray(config.levels) ? config.levels : [];
  const source = configured.length ? configured : DEFAULT_LEVELS.map((name) => ({ name }));

  return source.slice(0, 3).map((level, index) => ({
    name: String(level?.name || DEFAULT_LEVELS[index]).trim().slice(0, 30) || DEFAULT_LEVELS[index],
    roleId: isSnowflake(level?.roleId) ? level.roleId : null
  }));
}

function resolveReasons(config) {
  const configured = Array.isArray(config.reasons) ? config.reasons : [];
  const source = configured.length ? configured : DEFAULT_REASONS;
  const seen = new Set();

  return source
    .filter((reason) => reason && typeof reason === "object")
    .map((reason, index) => ({
      key: normalizeReasonKey(reason.key || reason.label, index),
      label: String(reason.label || reason.name || `Motivo ${index + 1}`).trim().slice(0, 100)
    }))
    .filter((reason) => {
      if (!reason.label || seen.has(reason.key)) {
        return false;
      }

      seen.add(reason.key);
      return true;
    })
    .slice(0, 25);
}

function parseHexColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? Number.parseInt(value.trim().slice(1), 16)
    : fallback;
}

function resolveConfig(config) {
  return {
    commandName: normalizeCommandName(config.commandName),
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    logChannelId: isSnowflake(config.logChannelId) ? config.logChannelId : null,
    staffRoleIds: Array.isArray(config.staffRoleIds) ? config.staffRoleIds.filter(isSnowflake) : [],
    levels: resolveLevels(config),
    reasons: resolveReasons(config),
    accentColor: parseHexColor(config.accentColor, 0xf1c40f),
    exoneratedColor: parseHexColor(config.exoneratedColor, 0xed4245),
    expirationDays: Math.max(1, Math.min(Number(config.expirationDays) || DEFAULT_EXPIRATION_DAYS, 365)),
    expirationCheckIntervalMs: Math.max(
      60_000,
      (Number(config.expirationCheckMinutes) || DEFAULT_CHECK_INTERVAL_MINUTES) * 60_000
    )
  };
}

function createStorage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function recordPunishment(storage, payload) {
  const { data, error } = await storage.rpc("record_bot_punishment", {
    p_expires_at: payload.expiresAt,
    p_guild_id: payload.guildId,
    p_level: payload.level,
    p_moderator_id: payload.moderatorId,
    p_reason: payload.reason,
    p_role_id: payload.roleId,
    p_user_id: payload.userId
  });

  if (error) {
    throw error;
  }

  return data;
}

async function recordExoneration(storage, payload) {
  const { error } = await storage.rpc("record_bot_exoneration", {
    p_guild_id: payload.guildId,
    p_moderator_id: payload.moderatorId,
    p_reason: payload.reason,
    p_role_id: payload.roleId,
    p_user_id: payload.userId
  });

  if (error) {
    throw error;
  }
}

async function updatePunishmentStatus(storage, id, status, currentStatuses = ["active"]) {
  const { error } = await storage
    .from(PUNISHMENTS_TABLE)
    .update({
      status,
      removed_at: new Date().toISOString()
    })
    .eq("id", id)
    .in("status", currentStatuses);

  if (error) {
    throw error;
  }
}

async function findActivePunishment(storage, guildId, userId) {
  const { data, error } = await storage
    .from(PUNISHMENTS_TABLE)
    .select("id,guild_id,user_id,role_id,expires_at")
    .eq("guild_id", guildId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findRestorablePunishment(storage, guildId, userId) {
  const { data, error } = await storage
    .from(PUNISHMENTS_TABLE)
    .select("id,guild_id,user_id,role_id,expires_at,status,created_at")
    .eq("guild_id", guildId)
    .eq("user_id", userId)
    .in("status", ["active", "member_left"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function reactivatePunishment(storage, id) {
  const { error } = await storage
    .from(PUNISHMENTS_TABLE)
    .update({ status: "active", removed_at: null })
    .eq("id", id)
    .eq("status", "member_left");

  if (error) {
    throw error;
  }
}

function buildCommand(config) {
  return new SlashCommandBuilder()
    .setName(config.commandName)
    .setDescription("Aplica uma punicao progressiva a um membro.")
    .addUserOption((option) =>
      option
        .setName("membro")
        .setDescription("Membro que recebera a punicao.")
        .setRequired(true)
    )
    .addStringOption((option) => {
      option
        .setName("motivo")
        .setDescription("Motivo da punicao.")
        .setRequired(true);

      for (const reason of config.reasons) {
        option.addChoices({ name: reason.label, value: reason.key });
      }

      return option;
    });
}

function buildRemoveCommand() {
  return new SlashCommandBuilder()
    .setName(REMOVE_COMMAND_NAME)
    .setDescription("Remove a punicao ativa de um membro.")
    .addUserOption((option) =>
      option
        .setName("membro")
        .setDescription("Membro que tera a punicao removida.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("motivo")
        .setDescription("Motivo da remocao da punicao.")
        .setMaxLength(300)
        .setRequired(true)
    );
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  if (resolvedConfig.levels.length !== 3 || !resolvedConfig.reasons.length) {
    return [];
  }

  return [buildCommand(resolvedConfig), buildRemoveCommand()].map((command) => ({
    command: command.toJSON(),
    guildId: resolvedConfig.guildId
  }));
}

function canPunish(interaction, config) {
  if (!interaction.inGuild()) {
    return false;
  }

  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  if (config.staffRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId))) {
    return true;
  }

  return interaction.member.permissions.has(PermissionFlagsBits.KickMembers);
}

async function resolveConfiguredRoles(guild, config) {
  const roles = [];

  for (const level of config.levels) {
    let role = level.roleId
      ? guild.roles.cache.get(level.roleId) || await guild.roles.fetch(level.roleId).catch(() => null)
      : guild.roles.cache.find((candidate) => candidate.name.toLowerCase() === level.name.toLowerCase());

    if (!role) {
      throw new Error(`CONFIG_ROLE_NOT_FOUND:${level.name}`);
    }

    roles.push({ ...level, role });
  }

  if (new Set(roles.map((level) => level.role.id)).size !== 3) {
    throw new Error("CONFIG_DUPLICATE_ROLES");
  }

  return roles;
}

function buildLogCard(config, payload) {
  const color = payload.exonerated ? config.exoneratedColor : config.accentColor;
  const avatarUrl = payload.targetUser.displayAvatarURL({ size: 256 });

  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${payload.exonerated ? "Membro exonerado" : "Punicao aplicada"}`),
          new TextDisplayBuilder().setContent(
            payload.exonerated
              ? `**${payload.targetUser.tag}** chegou ao limite de advertencias e foi expulso do servidor.`
              : `${payload.targetUser} recebeu a advertencia **${payload.newLevel}** pelo motivo **${payload.reason}**.`
          )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(avatarUrl)
            .setDescription(`Avatar de ${payload.targetUser.tag}`)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `**Membro:** ${payload.targetUser.tag} (${payload.targetUser.id})`,
        `**Punicao anterior:** ${payload.previousLevel || "Nenhuma"}`,
        `**Nova punicao:** ${payload.exonerated ? "Exonerado" : payload.newLevel}`,
        `**Motivo:** ${payload.reason}`,
        `**Responsavel:** ${payload.moderator} (${payload.moderator.tag})`,
        `**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`,
        ...(payload.expiresAt ? [`**Expira:** <t:${Math.floor(Date.parse(payload.expiresAt) / 1000)}:R>`] : [])
      ].join("\n"))
    );
}

async function sendLog(interaction, config, payload) {
  if (!config.logChannelId) {
    return false;
  }

  const channel = interaction.guild.channels.cache.get(config.logChannelId)
    || await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    console.warn(`[punishments] Canal de logs invalido: ${config.logChannelId}.`);
    return false;
  }

  await channel.send({
    components: [buildLogCard(config, payload)],
    flags: MessageFlags.IsComponentsV2
  });

  return true;
}

async function sendRemovalLog(interaction, config, payload) {
  if (!config.logChannelId) {
    return;
  }

  const channel = interaction.guild.channels.cache.get(config.logChannelId)
    || await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  await channel.send({
    content: [
      `A punicao de ${payload.targetUser} foi removida por ${payload.moderator}.`,
      `**Motivo:** ${payload.reason}`,
      `**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`
    ].join("\n")
  });
}

function errorMessage(error) {
  if (error?.message?.startsWith("CONFIG_ROLE_NOT_FOUND:")) {
    const roleName = error.message.split(":").slice(1).join(":");
    return `O cargo de punicao \`${roleName}\` nao foi encontrado. Confira a configuracao do modulo.`;
  }

  if (error?.message === "CONFIG_DUPLICATE_ROLES") {
    return "Os tres niveis de punicao precisam apontar para cargos diferentes.";
  }

  return "Nao foi possivel aplicar a punicao agora.";
}

async function handleCommand(interaction, storage, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Este comando so pode ser usado dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!canPunish(interaction, config)) {
    await interaction.reply({ content: "Voce nao tem permissao para aplicar punicoes.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!storage) {
    await interaction.reply({
      content: "O armazenamento de punicoes nao esta configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser("membro", true);
  const reasonKey = interaction.options.getString("motivo", true);
  const reason = config.reasons.find((item) => item.key === reasonKey);

  if (!reason) {
    await interaction.reply({ content: "O motivo selecionado nao esta mais configurado.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: "Voce nao pode aplicar uma punicao em si mesmo.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (targetUser.bot) {
    await interaction.reply({ content: "Bots nao podem receber esta punicao.", flags: MessageFlags.Ephemeral });
    return;
  }

  const lockKey = `${interaction.guildId}:${targetUser.id}`;

  if (memberLocks.has(lockKey)) {
    await interaction.reply({ content: "Ja existe uma punicao sendo processada para esse membro.", flags: MessageFlags.Ephemeral });
    return;
  }

  memberLocks.add(lockKey);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      await interaction.editReply("Esse membro nao esta mais no servidor.");
      return;
    }

    const moderatorMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!moderatorMember) {
      await interaction.editReply("Nao consegui validar seu cargo no servidor.");
      return;
    }

    if (targetMember.id === interaction.guild.ownerId) {
      await interaction.editReply("O proprietario do servidor nao pode receber esta punicao.");
      return;
    }

    if (
      moderatorMember.id !== interaction.guild.ownerId
      && targetMember.roles.highest.comparePositionTo(moderatorMember.roles.highest) >= 0
    ) {
      await interaction.editReply("Voce so pode punir membros que estejam abaixo do seu cargo mais alto.");
      return;
    }

    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);

    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply("O bot precisa da permissao Gerenciar Cargos para aplicar punicoes.");
      return;
    }

    const levels = await resolveConfiguredRoles(interaction.guild, config);
    const currentIndexes = levels
      .map((level, index) => targetMember.roles.cache.has(level.role.id) ? index : -1)
      .filter((index) => index >= 0);
    const currentIndex = currentIndexes.length ? Math.max(...currentIndexes) : -1;
    const previousLevel = currentIndex >= 0 ? levels[currentIndex].name : null;
    const auditReason = `Punicao aplicada por ${interaction.user.tag}: ${reason.label}`.slice(0, 512);

    if (currentIndex === levels.length - 1) {
      if (!me.permissions.has(PermissionFlagsBits.KickMembers) || !targetMember.kickable) {
        await interaction.editReply("O membro chegou ao ADV3, mas o bot nao consegue expulsa-lo. Confira a permissao Expulsar Membros e a hierarquia de cargos.");
        return;
      }

      await targetMember.kick(`Exonerado por ${interaction.user.tag}: ${reason.label}`.slice(0, 512));

      await recordExoneration(storage, {
        guildId: interaction.guildId,
        moderatorId: interaction.user.id,
        reason: reason.label,
        roleId: levels[currentIndex].role.id,
        userId: targetUser.id
      }).catch((error) => {
        console.error("[punishments] Membro exonerado, mas o historico nao foi salvo.", error);
      });

      await sendLog(interaction, config, {
        exonerated: true,
        moderator: interaction.user,
        previousLevel,
        reason: reason.label,
        targetUser
      }).catch((error) => {
        console.error("[punishments] Falha ao registrar exoneracao.", error);
        return false;
      });

      await interaction.deleteReply();
      return;
    }

    const nextLevel = levels[currentIndex + 1];
    const warningRoles = levels.map((level) => level.role);

    if (!nextLevel.role.editable || warningRoles.some((role) => targetMember.roles.cache.has(role.id) && !role.editable)) {
      await interaction.editReply("O bot nao consegue gerenciar um dos cargos de punicao. Coloque o cargo do bot acima de ADV1, ADV2 e ADV3.");
      return;
    }

    const obsoleteRoles = warningRoles.filter((role) => role.id !== nextLevel.role.id && targetMember.roles.cache.has(role.id));
    const expiresAt = new Date(Date.now() + config.expirationDays * 86_400_000).toISOString();

    await targetMember.roles.add(nextLevel.role, auditReason);

    try {
      if (obsoleteRoles.length) {
        await targetMember.roles.remove(obsoleteRoles, auditReason);
      }

      await recordPunishment(storage, {
        expiresAt,
        guildId: interaction.guildId,
        level: currentIndex + 2,
        moderatorId: interaction.user.id,
        reason: reason.label,
        roleId: nextLevel.role.id,
        userId: targetUser.id
      });
    } catch (error) {
      await targetMember.roles.remove(nextLevel.role, "Reversao de uma progressao incompleta").catch((rollbackError) => {
        console.error("[punishments] Falha ao reverter progressao incompleta.", rollbackError);
      });

      if (obsoleteRoles.length) {
        await targetMember.roles.add(obsoleteRoles, "Reversao de uma progressao incompleta").catch((rollbackError) => {
          console.error("[punishments] Falha ao restaurar a punicao anterior.", rollbackError);
        });
      }

      throw error;
    }

    await sendLog(interaction, config, {
      exonerated: false,
      moderator: interaction.user,
      newLevel: nextLevel.name,
      previousLevel,
      reason: reason.label,
      targetUser,
      expiresAt
    }).catch((error) => {
      console.error("[punishments] Falha ao registrar punicao.", error);
      return false;
    });

    await interaction.deleteReply();
  } catch (error) {
    console.error("[punishments] Falha ao aplicar punicao.", error);
    await interaction.editReply(errorMessage(error)).catch(() => {});
  } finally {
    memberLocks.delete(lockKey);
  }
}

async function handleRemoveCommand(interaction, storage, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Este comando so pode ser usado dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!canPunish(interaction, config)) {
    await interaction.reply({ content: "Voce nao tem permissao para remover punicoes.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!storage) {
    await interaction.reply({
      content: "O armazenamento de punicoes nao esta configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser("membro", true);
  const reason = interaction.options.getString("motivo", true).trim();
  const lockKey = `${interaction.guildId}:${targetUser.id}`;

  if (memberLocks.has(lockKey)) {
    await interaction.reply({ content: "Ja existe uma alteracao sendo processada para esse membro.", flags: MessageFlags.Ephemeral });
    return;
  }

  memberLocks.add(lockKey);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      await interaction.editReply("Esse membro nao esta mais no servidor.");
      return;
    }

    const moderatorMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (
      !moderatorMember
      || (
        moderatorMember.id !== interaction.guild.ownerId
        && targetMember.roles.highest.comparePositionTo(moderatorMember.roles.highest) >= 0
      )
    ) {
      await interaction.editReply("Voce so pode remover punicoes de membros abaixo do seu cargo mais alto.");
      return;
    }

    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);

    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply("O bot precisa da permissao Gerenciar Cargos para remover punicoes.");
      return;
    }

    const levels = await resolveConfiguredRoles(interaction.guild, config);
    const warningRoles = levels
      .map((level) => level.role)
      .filter((role) => targetMember.roles.cache.has(role.id));
    const activeRecord = await findActivePunishment(storage, interaction.guildId, targetUser.id);

    if (!warningRoles.length && !activeRecord) {
      await interaction.editReply("Esse membro nao possui uma punicao ativa.");
      return;
    }

    if (warningRoles.some((role) => !role.editable)) {
      await interaction.editReply("O bot nao consegue remover um dos cargos de punicao. Confira a hierarquia de cargos.");
      return;
    }

    const auditReason = `Punicao removida por ${interaction.user.tag}: ${reason}`.slice(0, 512);

    if (warningRoles.length) {
      await targetMember.roles.remove(warningRoles, auditReason);
    }

    try {
      if (activeRecord) {
        await updatePunishmentStatus(storage, activeRecord.id, "removed_manually");
      }
    } catch (error) {
      if (warningRoles.length) {
        await targetMember.roles.add(warningRoles, "Reversao de uma remocao de punicao incompleta").catch((rollbackError) => {
          console.error("[punishments] Falha ao restaurar cargos apos erro no banco.", rollbackError);
        });
      }

      throw error;
    }

    await sendRemovalLog(interaction, config, {
      moderator: interaction.user,
      reason,
      targetUser
    }).catch((error) => {
      console.error("[punishments] Falha ao registrar remocao de punicao.", error);
    });

    await interaction.deleteReply();
  } catch (error) {
    console.error("[punishments] Falha ao remover punicao.", error);
    await interaction.editReply("Nao foi possivel remover a punicao agora.").catch(() => {});
  } finally {
    memberLocks.delete(lockKey);
  }
}

async function sendExpirationLog(client, config, record, status) {
  if (!config.logChannelId) {
    return;
  }

  const channel = client.channels.cache.get(config.logChannelId)
    || await client.channels.fetch(config.logChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const descriptions = {
    expired: `A punicao de <@${record.user_id}> expirou e foi encerrada.`,
    member_left: `A punicao de <@${record.user_id}> foi encerrada porque o membro nao esta mais no servidor.`,
    removed_manually: `A punicao de <@${record.user_id}> foi encerrada porque o cargo foi removido manualmente.`
  };

  await channel.send({ content: descriptions[status] || `A punicao de <@${record.user_id}> foi encerrada.` });
}

async function applyStoredPunishmentRole(member, levels, record) {
  const storedLevel = levels.find((level) => level.role.id === record.role_id);

  if (!storedLevel) {
    throw new Error(`O cargo salvo na punicao ${record.id} nao esta mais configurado.`);
  }

  if (!storedLevel.role.editable) {
    throw new Error(`O bot nao consegue reaplicar o cargo ${storedLevel.role.name}.`);
  }

  const obsoleteRoles = levels
    .map((level) => level.role)
    .filter((role) => role.id !== storedLevel.role.id && member.roles.cache.has(role.id));
  const needsStoredRole = !member.roles.cache.has(storedLevel.role.id);

  if (needsStoredRole) {
    await member.roles.add(storedLevel.role, "Punicao ativa reaplicada apos retorno ao servidor");
  }

  if (obsoleteRoles.length) {
    await member.roles.remove(obsoleteRoles, "Sincronizacao de punicao ativa");
  }

  return needsStoredRole || obsoleteRoles.length > 0;
}

async function sendRestorationLog(client, config, record) {
  if (!config.logChannelId) {
    return;
  }

  const channel = client.channels.cache.get(config.logChannelId)
    || await client.channels.fetch(config.logChannelId).catch(() => null);

  if (channel?.isTextBased()) {
    await channel.send({
      content: `A punicao ativa de <@${record.user_id}> foi reaplicada apos o membro retornar ao servidor.`
    });
  }
}

async function restorePunishmentOnJoin(client, storage, config, member) {
  if (!storage || (config.guildId && member.guild.id !== config.guildId)) {
    return;
  }

  const lockKey = `${member.guild.id}:${member.id}`;

  if (memberLocks.has(lockKey)) {
    return;
  }

  memberLocks.add(lockKey);

  try {
    const record = await findRestorablePunishment(storage, member.guild.id, member.id);

    if (!record) {
      return;
    }

    const expiresAt = Date.parse(record.expires_at);

    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      await updatePunishmentStatus(storage, record.id, "expired", ["active", "member_left"]);
      await sendExpirationLog(client, config, record, "expired").catch(() => {});
      return;
    }

    if (record.status === "member_left") {
      await reactivatePunishment(storage, record.id);
    }

    const levels = await resolveConfiguredRoles(member.guild, config);
    const restored = await applyStoredPunishmentRole(member, levels, record);

    if (restored) {
      await sendRestorationLog(client, config, record).catch((error) => {
        console.error("[punishments] Falha ao registrar reaplicacao de cargo.", error);
      });
    }
  } finally {
    memberLocks.delete(lockKey);
  }
}

async function processActivePunishment(client, storage, config, levels, record) {
  const lockKey = `${record.guild_id}:${record.user_id}`;

  if (memberLocks.has(lockKey)) {
    return;
  }

  memberLocks.add(lockKey);

  try {
    const guild = client.guilds.cache.get(record.guild_id);
    const expiresAt = Date.parse(record.expires_at);
    const isExpired = Number.isFinite(expiresAt) && expiresAt <= Date.now();

    if (!guild) {
      throw new Error(`Servidor nao esta disponivel no cache: ${record.guild_id}`);
    }

    let member;

    try {
      member = await guild.members.fetch(record.user_id);
    } catch (error) {
      if (error?.code !== 10007) {
        throw error;
      }

      member = null;
    }

    if (!member) {
      if (isExpired) {
        await updatePunishmentStatus(storage, record.id, "expired");
        await sendExpirationLog(client, config, record, "expired").catch(() => {});
      }

      return;
    }

    const configuredRoleIds = levels.map((level) => level.role.id);
    const currentWarningRoles = configuredRoleIds.filter((roleId) => member.roles.cache.has(roleId));

    if (!isExpired) {
      const restored = await applyStoredPunishmentRole(member, levels, record);

      if (restored) {
        await sendRestorationLog(client, config, record).catch(() => {});
      }

      return;
    }

    if (currentWarningRoles.length) {
      await member.roles.remove(currentWarningRoles, "Punicao expirada");
    }

    await updatePunishmentStatus(storage, record.id, "expired");
    await sendExpirationLog(client, config, record, "expired").catch((error) => {
      console.error("[punishments] Falha ao registrar expiracao.", error);
    });
  } finally {
    memberLocks.delete(lockKey);
  }
}

async function sweepPunishments(client, storage, config) {
  const guild = client.guilds.cache.get(config.guildId)
    || await client.guilds.fetch(config.guildId).catch(() => null);

  if (!guild) {
    throw new Error(`Servidor de punicoes nao encontrado: ${config.guildId}`);
  }

  const levels = await resolveConfiguredRoles(guild, config);
  const { data, error } = await storage
    .from(PUNISHMENTS_TABLE)
    .select("id,guild_id,user_id,role_id,expires_at")
    .eq("guild_id", config.guildId)
    .eq("status", "active")
    .order("expires_at", { ascending: true })
    .limit(500);

  if (error) {
    throw error;
  }

  for (const record of data || []) {
    await processActivePunishment(client, storage, config, levels, record).catch((processError) => {
      console.error(`[punishments] Falha ao verificar punicao ${record.id}.`, processError);
    });
  }
}

async function handleManualRoleRemoval(client, storage, config, oldMember, newMember) {
  if (!storage || (config.guildId && newMember.guild.id !== config.guildId)) {
    return;
  }

  const warningRoleIds = config.levels.map((level) => level.roleId).filter(Boolean);
  const removedWarningRole = warningRoleIds.some((roleId) => (
    oldMember.roles.cache.has(roleId) && !newMember.roles.cache.has(roleId)
  ));
  const stillHasWarningRole = warningRoleIds.some((roleId) => newMember.roles.cache.has(roleId));

  if (!removedWarningRole || stillHasWarningRole) {
    return;
  }

  const lockKey = `${newMember.guild.id}:${newMember.id}`;

  if (memberLocks.has(lockKey)) {
    return;
  }

  memberLocks.add(lockKey);

  try {
    const activeRecord = await findActivePunishment(storage, newMember.guild.id, newMember.id);

    if (!activeRecord) {
      return;
    }

    await updatePunishmentStatus(storage, activeRecord.id, "removed_manually");
    await sendExpirationLog(client, config, activeRecord, "removed_manually").catch((error) => {
      console.error("[punishments] Falha ao registrar remocao manual de cargo.", error);
    });
  } finally {
    memberLocks.delete(lockKey);
  }
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);
  const storage = createStorage();

  client.once(Events.ClientReady, async () => {
    if (!storage) {
      console.warn("[punishments] Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para usar expiracoes.");
      return;
    }

    const sweep = () => sweepPunishments(client, storage, resolvedConfig).catch((error) => {
      console.error("[punishments] Falha na verificacao de expiracoes.", error);
    });

    await sweep();
    const interval = setInterval(sweep, resolvedConfig.expirationCheckIntervalMs);
    interval.unref();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      !interaction.isChatInputCommand()
      || ![resolvedConfig.commandName, REMOVE_COMMAND_NAME].includes(interaction.commandName)
    ) {
      return;
    }

    if (resolvedConfig.guildId && interaction.guildId !== resolvedConfig.guildId) {
      return;
    }

    const handler = interaction.commandName === REMOVE_COMMAND_NAME
      ? handleRemoveCommand
      : handleCommand;

    await handler(interaction, storage, resolvedConfig).catch(async (error) => {
      console.error("[punishments] Erro inesperado no comando.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Nao foi possivel processar a punicao agora.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    void handleManualRoleRemoval(client, storage, resolvedConfig, oldMember, newMember).catch((error) => {
      console.error("[punishments] Falha ao sincronizar remocao manual de cargo.", error);
    });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    void restorePunishmentOnJoin(client, storage, resolvedConfig, member).catch((error) => {
      console.error("[punishments] Falha ao restaurar punicao no retorno do membro.", error);
    });
  });
}

module.exports = {
  getCommands,
  register
};
