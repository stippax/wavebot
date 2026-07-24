const fs = require("node:fs");
const path = require("node:path");
const {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

const COMMAND_NAME = "cargo";

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function normalizeEmoji(rawEmoji, guild) {
  if (typeof rawEmoji !== "string") {
    return null;
  }

  const trimmed = rawEmoji.trim();
  const customEmojiMatch = trimmed.match(/^<a?:(\w+):(\d+)>$/);

  if (customEmojiMatch) {
    const [, emojiName, emojiId] = customEmojiMatch;
    return {
      key: `custom:${emojiId}`,
      reactValue: emojiId,
      display: trimmed,
      type: "custom"
    };
  }

  if (isSnowflake(trimmed)) {
    const emoji = guild?.emojis?.cache.get(trimmed) || null;

    return {
      key: `custom:${trimmed}`,
      reactValue: trimmed,
      display: emoji ? `<:${emoji.name}:${emoji.id}>` : trimmed,
      type: "custom"
    };
  }

  if (!trimmed) {
    return null;
  }

  return {
    key: `unicode:${trimmed}`,
    reactValue: trimmed,
    display: trimmed,
    type: "unicode"
  };
}

function resolveMessageReference(input, guildId) {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  const urlMatch = trimmed.match(/^https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/);

  if (urlMatch) {
    const [, parsedGuildId, channelId, messageId] = urlMatch;

    if (parsedGuildId !== guildId) {
      return null;
    }

    return { channelId, messageId };
  }

  const splitMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (splitMatch) {
    const [, channelId, messageId] = splitMatch;
    return { channelId, messageId };
  }

  if (isSnowflake(trimmed)) {
    return { channelId: null, messageId: trimmed };
  }

  return null;
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Gerencia cargos por reacao.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reacao")
        .setDescription("Cria uma regra de cargo por reacao.")
        .addStringOption((option) =>
          option
            .setName("mensagem")
            .setDescription("Link da mensagem ou channelId/messageId.")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("emoji")
            .setDescription("Emoji que vai ativar o cargo.")
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("cargo")
            .setDescription("Cargo que sera alternado ao reagir.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remover-reacao")
        .setDescription("Remove uma regra de cargo por reacao.")
        .addStringOption((option) =>
          option
            .setName("mensagem")
            .setDescription("Link da mensagem ou channelId/messageId.")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("emoji")
            .setDescription("Emoji usado na regra.")
            .setRequired(true)
        )
    );
}

function resolveConfig(config) {
  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    mappings: Array.isArray(config.mappings) ? config.mappings : []
  };
}

function saveConfig(configFilePath, state) {
  fs.writeFileSync(
    configFilePath,
    `${JSON.stringify({ guildId: state.guildId, mappings: state.mappings }, null, 2)}\n`,
    "utf8"
  );
}

function findMappingIndex(mappings, messageId, emojiKey) {
  return mappings.findIndex((mapping) => mapping.messageId === messageId && mapping.emojiKey === emojiKey);
}

function findMappingForReaction(mappings, reaction) {
  const emojiKey = reaction.emoji.id
    ? `custom:${reaction.emoji.id}`
    : `unicode:${reaction.emoji.name}`;

  return mappings.find(
    (mapping) => mapping.messageId === reaction.message.id && mapping.emojiKey === emojiKey
  ) || null;
}

async function registerCommand(client, state) {
  const command = buildCommand().toJSON();

  if (!client.application) {
    return;
  }

  if (state.guildId) {
    await client.application.commands.create(command, state.guildId);
    return;
  }

  await client.application.commands.create(command);
}

async function fetchTargetMessage(interaction, messageReference) {
  if (!messageReference.channelId && messageReference.messageId) {
    const currentChannelMessage = await interaction.channel.messages.fetch(messageReference.messageId).catch(() => null);
    return currentChannelMessage || null;
  }

  const channel = await interaction.guild.channels.fetch(messageReference.channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  const message = await channel.messages.fetch(messageReference.messageId).catch(() => null);
  return message || null;
}

async function handleCreateMapping(interaction, state, configFilePath) {
  const messageInput = interaction.options.getString("mensagem", true);
  const emojiInput = interaction.options.getString("emoji", true);
  const role = interaction.options.getRole("cargo", true);

  const messageReference = resolveMessageReference(messageInput, interaction.guildId);
  if (!messageReference) {
    await interaction.reply({
      content: "A mensagem precisa ser um link valido do Discord, `channelId/messageId` ou apenas o `messageId` da mensagem no canal atual.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const normalizedEmoji = normalizeEmoji(emojiInput, interaction.guild);
  if (!normalizedEmoji) {
    await interaction.reply({
      content: "Nao consegui interpretar esse emoji.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const message = await fetchTargetMessage(interaction, messageReference);
  if (!message) {
    await interaction.reply({
      content: "Nao consegui encontrar essa mensagem neste servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const mapping = {
    guildId: interaction.guildId,
    channelId: message.channelId,
    messageId: message.id,
    roleId: role.id,
    emojiKey: normalizedEmoji.key,
    emojiValue: normalizedEmoji.reactValue,
    createdAt: new Date().toISOString()
  };

  const existingIndex = findMappingIndex(state.mappings, mapping.messageId, mapping.emojiKey);
  if (existingIndex >= 0) {
    state.mappings[existingIndex] = mapping;
  } else {
    state.mappings.push(mapping);
  }

  saveConfig(configFilePath, state);

  try {
    await message.react(normalizedEmoji.reactValue);
  } catch (error) {
    state.mappings = state.mappings.filter(
      (item) => !(item.messageId === mapping.messageId && item.emojiKey === mapping.emojiKey)
    );
    saveConfig(configFilePath, state);

    await interaction.reply({
      content: "Nao consegui adicionar essa reacao na mensagem. Verifique o emoji e as permissoes do bot.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    content: `Cargo ${role} configurado para a reacao ${normalizedEmoji.display} na [mensagem](${message.url}).`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleRemoveMapping(interaction, state, configFilePath) {
  const messageInput = interaction.options.getString("mensagem", true);
  const emojiInput = interaction.options.getString("emoji", true);

  const messageReference = resolveMessageReference(messageInput, interaction.guildId);
  const normalizedEmoji = normalizeEmoji(emojiInput, interaction.guild);

  if (!messageReference || !normalizedEmoji) {
    await interaction.reply({
      content: "Forneca uma mensagem e um emoji validos.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const existingIndex = findMappingIndex(state.mappings, messageReference.messageId, normalizedEmoji.key);
  if (existingIndex < 0) {
    await interaction.reply({
      content: "Nao existe uma regra cadastrada para essa mensagem com esse emoji.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetMessage = await fetchTargetMessage(interaction, messageReference);
  const [removedMapping] = state.mappings.splice(existingIndex, 1);
  saveConfig(configFilePath, state);

  let reactionRemoved = false;

  if (targetMessage) {
    const reaction = targetMessage.reactions.cache.find((item) =>
      removedMapping.emojiKey.startsWith("custom:")
        ? item.emoji.id === removedMapping.emojiKey.slice("custom:".length)
        : item.emoji.name === removedMapping.emojiKey.slice("unicode:".length)
    );

    if (reaction) {
      await reaction.remove().then(() => {
        reactionRemoved = true;
      }).catch(() => {});
    }
  }

  await interaction.reply({
    content: reactionRemoved
      ? `Regra removida e a reacao ${normalizedEmoji.display} foi apagada da mensagem \`${removedMapping.messageId}\`.`
      : `Regra removida para a reacao ${normalizedEmoji.display} na mensagem \`${removedMapping.messageId}\`.`,
    flags: MessageFlags.Ephemeral
  });
}

async function toggleRoleForReaction(reaction, user, state, action) {
  if (user.bot) {
    return;
  }

  if (reaction.partial) {
    await reaction.fetch().catch(() => null);
  }

  if (!reaction.message.guild) {
    return;
  }

  const mapping = findMappingForReaction(state.mappings, reaction);
  if (!mapping) {
    return;
  }

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return;
  }

  try {
    if (action === "add") {
      if (!member.roles.cache.has(mapping.roleId)) {
        await member.roles.add(mapping.roleId, "Cargo por reacao");
      }
      return;
    }

    if (member.roles.cache.has(mapping.roleId)) {
      await member.roles.remove(mapping.roleId, "Cargo por reacao");
    }
  } catch (error) {
    console.error("[reaction-roles] Falha ao alternar cargo por reacao.", error);
  }
}

async function register({ client, config, modulePath }) {
  const configFilePath = path.join(modulePath, "config.json");
  const state = resolveConfig(config);

  client.once(Events.ClientReady, async () => {
    try {
      await registerCommand(client, state);
    } catch (error) {
      console.error("[reaction-roles] Falha ao registrar slash command.", error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== COMMAND_NAME) {
      return;
    }

    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Esse comando so pode ser usado dentro de um servidor.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "reacao") {
        await handleCreateMapping(interaction, state, configFilePath);
        return;
      }

      if (subcommand === "remover-reacao") {
        await handleRemoveMapping(interaction, state, configFilePath);
      }
    } catch (error) {
      console.error("[reaction-roles] Falha ao executar comando.", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Nao foi possivel concluir esse comando agora.",
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    }
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    await toggleRoleForReaction(reaction, user, state, "add");
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    await toggleRoleForReaction(reaction, user, state, "remove");
  });
}

module.exports = {
  register
};
