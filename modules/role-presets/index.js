const {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function normalizeCommandName(value) {
  if (typeof value !== "string") {
    return "cargo-preset";
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized || normalized.length < 1 || normalized.length > 32) {
    return "cargo-preset";
  }

  return normalized;
}

function normalizePresetKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 100);
}

function resolvePresets(config) {
  if (!Array.isArray(config.presets)) {
    return [];
  }

  return config.presets
    .filter((preset) => preset && typeof preset === "object")
    .map((preset) => ({
      key: normalizePresetKey(preset.key || preset.name || preset.label),
      label: String(preset.label || preset.name || preset.key || "Preset").slice(0, 100),
      roleIds: Array.isArray(preset.roleIds) ? preset.roleIds.filter(isSnowflake) : []
    }))
    .filter((preset) => preset.key && preset.roleIds.length > 0);
}

function resolveConfig(config) {
  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    commandName: normalizeCommandName(config.commandName),
    presets: resolvePresets(config)
  };
}

function buildCommand(config) {
  const command = new SlashCommandBuilder()
    .setName(config.commandName)
    .setDescription("Entrega um conjunto predefinido de cargos.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption((option) => {
      option
        .setName("preset")
        .setDescription("Nome do preset de cargos.")
        .setRequired(true);

      for (const preset of config.presets.slice(0, 25)) {
        option.addChoices({ name: preset.label, value: preset.key });
      }

      return option;
    })
    .addUserOption((option) =>
      option
        .setName("membro")
        .setDescription("Membro que vai receber os cargos do preset.")
        .setRequired(true)
    );

  return command;
}

function findPreset(config, key) {
  return config.presets.find((preset) => preset.key === key) || null;
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);

  if (!resolvedConfig.presets.length) {
    return [];
  }

  return [{
    command: buildCommand(resolvedConfig).toJSON(),
    guildId: resolvedConfig.guildId
  }];
}

async function resolveInteractionGuild(interaction) {
  if (!interaction.guildId) {
    return null;
  }

  return interaction.guild
    || interaction.client.guilds.cache.get(interaction.guildId)
    || await interaction.client.guilds.fetch(interaction.guildId).catch(() => null);
}

async function handleCommand(interaction, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Este comando so pode ser usado dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const guild = await resolveInteractionGuild(interaction);

  if (!guild) {
    await interaction.reply({
      content: "Nao consegui carregar os dados deste servidor agora.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const presetKey = interaction.options.getString("preset", true);
  const targetUser = interaction.options.getUser("membro", true);
  const preset = findPreset(config, presetKey);

  if (!preset) {
    await interaction.reply({
      content: "Nao encontrei esse preset de cargos.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "Nao consegui encontrar esse membro no servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: "O bot precisa da permissao Manage Roles para aplicar este preset.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const rolesToGrant = [];

  for (const roleId of preset.roleIds) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      await interaction.reply({
        content: `Um dos cargos do preset \`${preset.label}\` nao existe mais neste servidor.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!role.editable) {
      await interaction.reply({
        content: `O bot nao consegue entregar o cargo ${role}. Verifique a hierarquia do servidor.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    rolesToGrant.push(role);
  }

  const missingRoles = rolesToGrant.filter((role) => !targetMember.roles.cache.has(role.id));

  if (missingRoles.length === 0) {
    await interaction.reply({
      content: `${targetMember} ja possui todos os cargos do preset \`${preset.label}\`.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await targetMember.roles.add(missingRoles, `Preset de cargos aplicado por ${interaction.user.tag}`);

  await interaction.reply({
    content: `${targetMember} recebeu ${missingRoles.length} cargo(s) do preset \`${preset.label}\`: ${missingRoles.map((role) => role.toString()).join(", ")}.`,
    flags: MessageFlags.Ephemeral
  });
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== resolvedConfig.commandName) {
      return;
    }

    try {
      await handleCommand(interaction, resolvedConfig);
    } catch (error) {
      console.error("[role-presets] Falha ao aplicar preset.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel aplicar esse preset agora.",
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
