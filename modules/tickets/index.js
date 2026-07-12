const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  UserSelectMenuBuilder
} = require("discord.js");
const { buildTranscript, saveTranscript, getTranscriptConfigurationIssues } = require("./transcripts");

const TICKET_TYPE_SELECT_ID = "tickets:type-select";
const CLOSE_TICKET_BUTTON_ID = "tickets:close";
const STAFF_MENU_BUTTON_ID = "tickets:staff-menu";
const LEAVE_TICKET_BUTTON_ID = "tickets:leave";
const ADD_MEMBER_BUTTON_ID = "tickets:add-member";
const REMOVE_MEMBER_BUTTON_ID = "tickets:remove-member";
const ADD_MEMBER_SELECT_ID = "tickets:add-member-select";
const REMOVE_MEMBER_SELECT_ID = "tickets:remove-member-select";
const TICKET_TOPIC_PREFIX = "ticket-owner:";
const closingTicketIds = new Set();

function isConsumedInteractionError(error) {
  return error?.code === 10062 || error?.code === 40060;
}

async function deferEphemeralReply(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    if (isConsumedInteractionError(error)) {
      return false;
    }

    throw error;
  }
}

async function deferInteractionUpdate(interaction) {
  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (isConsumedInteractionError(error)) {
      return false;
    }

    throw error;
  }
}

async function sendEphemeralResponse(interaction, payload) {
  if (interaction.deferred) {
    return interaction.editReply(payload).catch(() => {});
  }

  if (interaction.replied) {
    return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
}

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function sanitizeChannelName(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function normalizeChannelEmoji(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  return value.trim()
    .replace(/<a?:.+?:(\d+)>/g, "$1")
    .replace(/\s+/g, "");
}

function buildTicketChannelName(member, config, ticketType) {
  const baseName = sanitizeChannelName(member.displayName || member.user.username) || "usuario";
  const category = ticketType.channelPrefix || sanitizeChannelName(config.ticketNamePrefix || "ticket") || "ticket";
  const emoji = normalizeChannelEmoji(ticketType.emoji);
  const prefix = emoji ? `${emoji}・${category}` : category;

  return `${prefix}-${baseName}`.slice(0, 90);
}

function formatDate(value) {
  return `<t:${Math.floor(value.getTime() / 1000)}:F>`;
}

function resolveTicketTypes(config) {
  if (!Array.isArray(config.ticketTypes)) {
    return [];
  }

  return config.ticketTypes
    .filter((type) => type && typeof type === "object")
    .map((type) => ({
      value: sanitizeChannelName(type.value || type.label || ""),
      label: String(type.label || "Ticket").slice(0, 100),
      description: type.description ? String(type.description).slice(0, 100) : undefined,
      emoji: type.emoji || undefined,
      channelPrefix: sanitizeChannelName(type.channelPrefix || type.value || type.label || "ticket") || "ticket",
      welcomeMessage: type.welcomeMessage || null,
      staffRoleId: isSnowflake(type.staffRoleId) ? type.staffRoleId : null
    }))
    .filter((type) => type.value);
}

function resolveConfig(config) {
  return {
    ...config,
    panelChannelId: isSnowflake(config.panelChannelId) ? config.panelChannelId : null,
    categoryId: isSnowflake(config.categoryId) ? config.categoryId : null,
    staffRoleId: isSnowflake(config.staffRoleId) ? config.staffRoleId : null,
    ticketLogChannelId: isSnowflake(config.ticketLogChannelId) ? config.ticketLogChannelId : null,
    ticketTypes: resolveTicketTypes(config)
  };
}

function findTicketType(config, value) {
  return config.ticketTypes.find((type) => type.value === value) || null;
}

function buildPanelCard(config) {
  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${config.panelTitle || "Central de Atendimento"}`),
          new TextDisplayBuilder().setContent(
            config.panelDescription ||
            "Selecione abaixo o tipo de atendimento que voce deseja abrir."
          )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL("https://cdn.discordapp.com/embed/avatars/0.png")
            .setDescription("Painel de tickets")
        )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        config.ticketTypes
          .map((type) => `**${type.label}:** ${type.description || "Atendimento dedicado para este assunto."}`)
          .join("\n")
      )
    );
}

function buildPanelComponents(config) {
  return [
    buildPanelCard(config),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(TICKET_TYPE_SELECT_ID)
        .setPlaceholder(config.selectPlaceholder || "Selecione o tipo de ticket")
        .addOptions(
          config.ticketTypes.map((type) => ({
            label: type.label,
            value: type.value,
            description: type.description,
            emoji: type.emoji
          }))
        )
    )
  ];
}

function buildTicketCard(member, config, ticketType) {
  const effectiveStaffRoleId = ticketType.staffRoleId || config.staffRoleId;
  const welcomeMessage = ticketType.welcomeMessage || config.welcomeMessage;
  const mentionLine = effectiveStaffRoleId
    ? `${member} <@&${effectiveStaffRoleId}>`
    : `${member}`;

  return new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## Ticket de ${ticketType.label}`),
          new TextDisplayBuilder().setContent(`${mentionLine}\n\nSeu atendimento foi criado com sucesso.`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(member.user.displayAvatarURL({ size: 256 }))
            .setDescription(`Avatar de ${member.user.tag}`)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Tipo:** ${ticketType.label}`,
          `**Usuario:** ${member.user.tag}`,
          `**Criado em:** ${formatDate(new Date())}`,
          effectiveStaffRoleId ? `**Equipe notificada:** <@&${effectiveStaffRoleId}>` : null,
          "",
          welcomeMessage || "Descreva aqui o que voce precisa para a equipe continuar o atendimento."
        ].filter(Boolean).join("\n")
      )
    )
    .addActionRowComponents(...buildTicketActionRows(config));
}

function buildTicketActionRows(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(STAFF_MENU_BUTTON_ID)
        .setLabel(config.staffMenuButtonLabel || "Menu Staff")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(LEAVE_TICKET_BUTTON_ID)
        .setLabel(config.leaveTicketButtonLabel || "Sair do Ticket")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CLOSE_TICKET_BUTTON_ID)
        .setLabel(config.closeButtonLabel || "Fechar Ticket")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function isConfigured(config) {
  return Boolean(config.panelChannelId && config.categoryId && config.ticketTypes.length);
}

function isTicketChannel(channel) {
  return channel?.topic?.startsWith(TICKET_TOPIC_PREFIX);
}

function getTicketMetadata(channel) {
  if (!isTicketChannel(channel)) {
    return null;
  }

  const parts = channel.topic.slice(TICKET_TOPIC_PREFIX.length).split("|");
  return {
    ownerId: parts[0] || null,
    ticketType: parts[1] || null,
    createdAt: Number(parts[2]) || null
  };
}

function canManageTicketMembers(interaction, config) {
  return isStaffMember(interaction, config);
}

function isStaffMember(interaction, config) {
  return Boolean(config.staffRoleId && interaction.member.roles.cache.has(config.staffRoleId));
}

function canCloseTicket(interaction, config) {
  const metadata = getTicketMetadata(interaction.channel);
  const isOwner = interaction.user.id === metadata?.ownerId;
  const isStaff = isStaffMember(interaction, config);

  return isOwner || isStaff;
}

function canLeaveTicket(interaction) {
  const metadata = getTicketMetadata(interaction.channel);
  const overwrite = interaction.channel.permissionOverwrites.cache.get(interaction.user.id);

  return interaction.user.id === metadata?.ownerId || Boolean(overwrite);
}

function buildMemberSelect(customId, placeholder) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
    )
  ];
}

function buildStaffMenuComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ADD_MEMBER_BUTTON_ID)
        .setLabel(config.addMemberButtonLabel || "Adicionar Membro")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(REMOVE_MEMBER_BUTTON_ID)
        .setLabel(config.removeMemberButtonLabel || "Remover Membro")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function componentTreeHasCustomId(component, customId) {
  if (!component) {
    return false;
  }

  if (component.customId === customId) {
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

function messageHasCustomId(message, customId) {
  return message.components.some((component) => componentTreeHasCustomId(component, customId));
}

async function ensurePanel(client, config) {
  if (!isConfigured(config)) {
    console.warn("[tickets] panelChannelId, categoryId ou ticketTypes nao configurados.");
    return;
  }

  const channel = await client.channels.fetch(config.panelChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    console.warn(`[tickets] Canal de painel invalido: ${config.panelChannelId}.`);
    return;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const existingMessage = messages?.find(
    (message) => message.author.id === client.user.id && messageHasCustomId(message, TICKET_TYPE_SELECT_ID)
  );

  const payload = {
    components: buildPanelComponents(config),
    flags: MessageFlags.IsComponentsV2
  };

  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

async function sendTicketLog(client, guild, config, payload) {
  if (!config.ticketLogChannelId) {
    return;
  }

  const channel = await client.channels.fetch(config.ticketLogChannelId).catch(() => null);

  if (!channel || !channel.isTextBased() || channel.guild?.id !== guild.id) {
    return;
  }

  const messagePayload = typeof payload === "string" ? { content: payload } : payload;

  await channel.send(messagePayload).catch(() => {});
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function buildTranscriptLinkButton(url) {
  if (!url) {
    return null;
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setEmoji("🔒")
      .setLabel("Acessar Historico")
  );
}

function buildTranscriptEmbed({ transcript, password, url, includePassword }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Historico de ticket gerado")
    .setDescription("O historico desta conversa foi salvo e pode ser acessado pelo botao abaixo.")
    .addFields(
      { name: "Ticket", value: `#${truncate(transcript.channelName, 1000)}`, inline: true },
      { name: "Mensagens", value: String(transcript.messages.length), inline: true }
    )
    .setTimestamp(new Date(transcript.closedAt));

  if (includePassword) {
    embed.addFields({ name: "Senha", value: `\`\`\`\n${password}\n\`\`\``, inline: false });
  }

  if (transcript.closedBy?.avatarUrl) {
    embed.setThumbnail(transcript.closedBy.avatarUrl);
  }

  return embed;
}

async function notifyTranscriptMembers(client, guild, transcript, password, url) {
  const embed = buildTranscriptEmbed({
    transcript,
    password,
    url,
    includePassword: true
  });
  const linkButton = buildTranscriptLinkButton(url);

  const uniqueIds = [...new Set(transcript.participants)]
    .filter((id) => id && id !== client.user.id);

  const results = await Promise.allSettled(
    uniqueIds.map(async (userId) => {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [embed],
        components: linkButton ? [linkButton] : []
      });
      return userId;
    })
  );

  return {
    total: uniqueIds.length,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length
  };
}

async function findOpenTicket(guild, userId, config) {
  const channels = await guild.channels.fetch();

  return channels.find((channel) =>
    channel &&
    channel.parentId === config.categoryId &&
    channel.type === ChannelType.GuildText &&
    getTicketMetadata(channel)?.ownerId === userId
  );
}

async function createTicket(interaction, config, ticketType) {
  const deferred = await deferEphemeralReply(interaction);

  if (!deferred) {
    return;
  }

  const existingTicket = await findOpenTicket(interaction.guild, interaction.user.id, config);

  if (existingTicket) {
    await interaction.editReply({
      content: `Voce ja possui um ticket aberto em ${existingTicket}.`
    });
    return;
  }

  const effectiveStaffRoleId = ticketType.staffRoleId || config.staffRoleId;
  const channelName = buildTicketChannelName(interaction.member, config, ticketType);

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  if (effectiveStaffRoleId) {
    permissionOverwrites.push({
      id: effectiveStaffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  const ticketChannel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.categoryId,
    topic: `${TICKET_TOPIC_PREFIX}${interaction.user.id}|${ticketType.value}|${Date.now()}`,
    permissionOverwrites
  });

  try {
    await ticketChannel.send({
      components: [buildTicketCard(interaction.member, config, ticketType)],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    await ticketChannel.delete("Falha ao enviar mensagem inicial do ticket").catch(() => {});
    throw error;
  }

  await interaction.editReply({
    content: `Seu ticket de **${ticketType.label}** foi criado em ${ticketChannel}.`
  });
}

async function closeTicket(interaction, client, config) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    await sendEphemeralResponse(interaction, {
      content: "Este botao so pode ser usado em um canal de ticket."
    });
    return;
  }

  if (!canCloseTicket(interaction, config)) {
    await sendEphemeralResponse(interaction, {
      content: "Apenas o criador do ticket ou a equipe podem fechar este atendimento."
    });
    return;
  }

  const deferred = await deferInteractionUpdate(interaction);

  if (!deferred) {
    return;
  }

  if (closingTicketIds.has(channel.id)) {
    await interaction.followUp({
      content: "Este ticket ja esta sendo fechado.",
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return;
  }

  closingTicketIds.add(channel.id);

  const sendStatusMessage = (content) => interaction.followUp({ content }).catch(() => {});

  let transcript;
  let access;
  let dmStats = null;

  try {
    transcript = await buildTranscript(channel, getTicketMetadata(channel), interaction.user);
    access = await saveTranscript(config, transcript);

    await sendTicketLog(client, interaction.guild, config, {
      embeds: [
        buildTranscriptEmbed({
          transcript,
          password: access.password,
          url: access.url,
          includePassword: true
        })
      ],
      components: access.url ? [buildTranscriptLinkButton(access.url)] : []
    });

    dmStats = await notifyTranscriptMembers(client, interaction.guild, transcript, access.password, access.url);
  } catch (error) {
    console.error("[tickets] Falha ao gerar historico do ticket.", error);

    await sendStatusMessage("Nao foi possivel salvar o historico deste ticket. O canal nao foi apagado.");
    closingTicketIds.delete(channel.id);
    return;
  }

  await sendStatusMessage(
    [
      "Ticket fechado. O historico foi salvo e este canal sera apagado em 5 segundos.",
      access.url ? `Link: ${access.url}` : null,
      dmStats ? `DMs enviadas: ${dmStats.sent}/${dmStats.total}.` : null
    ].filter(Boolean).join("\n")
  );

  setTimeout(async () => {
    await channel.delete("Ticket encerrado").catch((error) => {
      if (error?.code !== 10003) {
        console.error("[tickets] Falha ao apagar canal de ticket.", error);
      }
    });
    closingTicketIds.delete(channel.id);
  }, 5000);
}

async function openStaffMenu(interaction, config) {
  const deferred = await deferEphemeralReply(interaction);

  if (!deferred) {
    return;
  }

  if (!isTicketChannel(interaction.channel)) {
    await sendEphemeralResponse(interaction, {
      content: "Este controle so pode ser usado em um canal de ticket."
    });
    return;
  }

  if (!isStaffMember(interaction, config)) {
    await sendEphemeralResponse(interaction, {
      content: "Apenas a equipe pode usar o Menu Staff."
    });
    return;
  }

  await sendEphemeralResponse(interaction, {
    content: "Menu Staff deste ticket.",
    components: buildStaffMenuComponents(config)
  });
}

async function promptMemberSelection(interaction, config, mode) {
  const deferred = await deferEphemeralReply(interaction);

  if (!deferred) {
    return;
  }

  if (!isTicketChannel(interaction.channel)) {
    await sendEphemeralResponse(interaction, {
      content: "Este controle so pode ser usado em um canal de ticket."
    });
    return;
  }

  if (!canManageTicketMembers(interaction, config)) {
    await sendEphemeralResponse(interaction, {
      content: "Apenas o criador do ticket ou a equipe podem gerenciar membros."
    });
    return;
  }

  const customId = mode === "add" ? ADD_MEMBER_SELECT_ID : REMOVE_MEMBER_SELECT_ID;
  const placeholder = mode === "add"
    ? "Selecione quem deve entrar no ticket"
    : "Selecione quem deve sair do ticket";

  await sendEphemeralResponse(interaction, {
    content: mode === "add"
      ? "Escolha um usuario para adicionar a este ticket."
      : "Escolha um usuario para remover deste ticket.",
    components: buildMemberSelect(customId, placeholder)
  });
}

async function leaveTicket(interaction, client, config) {
  if (!isTicketChannel(interaction.channel)) {
    await interaction.reply({
      content: "Este controle so pode ser usado em um canal de ticket.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canLeaveTicket(interaction)) {
    await interaction.reply({
      content: "Somente o criador do ticket ou membros adicionados manualmente podem sair deste ticket.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.channel.permissionOverwrites.delete(interaction.user.id).catch(() => {});

  await interaction.reply({
    content: "Voce saiu deste ticket.",
    flags: MessageFlags.Ephemeral
  });

  await sendTicketLog(
    client,
    interaction.guild,
    config,
    `${interaction.user} saiu do ticket ${interaction.channel}.`
  );
}

async function addMemberToTicket(interaction, client, config) {
  const deferred = await deferInteractionUpdate(interaction);

  if (!deferred) {
    return;
  }

  if (!isTicketChannel(interaction.channel)) {
    return;
  }

  if (!canManageTicketMembers(interaction, config)) {
    return;
  }

  const userId = interaction.values[0];
  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (!member) {
    await interaction.followUp({
      content: "Nao foi possivel encontrar este usuario no servidor.",
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return;
  }

  await interaction.channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true
  });

  await interaction.channel.send({
    content: `${member} foi adicionado(a) ao ticket por ${interaction.user}.`
  }).catch(() => {});

  await sendTicketLog(
    client,
    interaction.guild,
    config,
    `${member} foi adicionado(a) ao ticket ${interaction.channel} por ${interaction.user}.`
  );
}

async function removeMemberFromTicket(interaction, client, config) {
  const deferred = await deferInteractionUpdate(interaction);

  if (!deferred) {
    return;
  }

  if (!isTicketChannel(interaction.channel)) {
    return;
  }

  if (!canManageTicketMembers(interaction, config)) {
    return;
  }

  const metadata = getTicketMetadata(interaction.channel);
  const userId = interaction.values[0];

  if (userId === metadata?.ownerId) {
    await interaction.followUp({
      content: "O criador do ticket nao pode ser removido deste canal.",
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return;
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  await interaction.channel.permissionOverwrites.delete(userId).catch(() => {});

  await interaction.channel.send({
    content: member
      ? `${member} foi removido(a) do ticket por ${interaction.user}.`
      : `Um usuario foi removido do ticket por ${interaction.user}.`
  }).catch(() => {});

  await sendTicketLog(
    client,
    interaction.guild,
    config,
    member
      ? `${member} foi removido(a) do ticket ${interaction.channel} por ${interaction.user}.`
      : `Um usuario foi removido do ticket ${interaction.channel} por ${interaction.user}.`
  );
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.once(Events.ClientReady, async () => {
    const transcriptIssues = getTranscriptConfigurationIssues(resolvedConfig);

    if (transcriptIssues.length) {
      console.warn(`[tickets] Transcript desativado ate ajustar: ${transcriptIssues.join("; ")}.`);
    }

    await ensurePanel(client, resolvedConfig).catch((error) => {
      console.error("[tickets] Falha ao preparar painel de tickets.", error);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === TICKET_TYPE_SELECT_ID) {
      try {
        const ticketType = findTicketType(resolvedConfig, interaction.values[0]);

        if (!ticketType) {
          await interaction.reply({
            content: "O tipo de ticket selecionado nao e valido.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await createTicket(interaction, resolvedConfig, ticketType);
      } catch (error) {
        console.error("[tickets] Falha ao criar ticket.", error);

        if (interaction.deferred) {
          await interaction.editReply({
            content: "Nao foi possivel criar seu ticket agora."
          }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({
            content: "Nao foi possivel criar seu ticket agora.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === ADD_MEMBER_SELECT_ID) {
      try {
        await addMemberToTicket(interaction, client, resolvedConfig);
      } catch (error) {
        console.error("[tickets] Falha ao adicionar membro ao ticket.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel adicionar este membro ao ticket.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === REMOVE_MEMBER_SELECT_ID) {
      try {
        await removeMemberFromTicket(interaction, client, resolvedConfig);
      } catch (error) {
        console.error("[tickets] Falha ao remover membro do ticket.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel remover este membro do ticket.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId === ADD_MEMBER_BUTTON_ID) {
      try {
        await promptMemberSelection(interaction, resolvedConfig, "add");
      } catch (error) {
        console.error("[tickets] Falha ao abrir seletor de adicionar membro.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel abrir o seletor de membros.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId === REMOVE_MEMBER_BUTTON_ID) {
      try {
        await promptMemberSelection(interaction, resolvedConfig, "remove");
      } catch (error) {
        console.error("[tickets] Falha ao abrir seletor de remover membro.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel abrir o seletor de remocao.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId === STAFF_MENU_BUTTON_ID) {
      try {
        await openStaffMenu(interaction, resolvedConfig);
      } catch (error) {
        console.error("[tickets] Falha ao abrir menu staff.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel abrir o Menu Staff.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId === LEAVE_TICKET_BUTTON_ID) {
      try {
        await leaveTicket(interaction, client, resolvedConfig);
      } catch (error) {
        console.error("[tickets] Falha ao sair do ticket.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel sair deste ticket agora.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId === CLOSE_TICKET_BUTTON_ID) {
      try {
        await closeTicket(interaction, client, resolvedConfig);
      } catch (error) {
        console.error("[tickets] Falha ao fechar ticket.", error);

        closingTicketIds.delete(interaction.channelId);

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Nao foi possivel fechar este ticket agora.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        } else {
          await interaction.reply({
            content: "Nao foi possivel fechar este ticket agora.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
    }
  });
}

module.exports = {
  register
};
