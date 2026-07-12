const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder
} = require("discord.js");

const OPEN_MODAL_CUSTOM_ID = "setagem-membros:open";
const SUBMIT_MODAL_CUSTOM_ID = "setagem-membros:submit";
const APPROVE_PREFIX = "setagem-membros:approve";
const DENY_PREFIX = "setagem-membros:deny";
const NAME_INPUT_CUSTOM_ID = "setagem-membros:nome";
const PLAYER_ID_INPUT_CUSTOM_ID = "setagem-membros:id";
const ROLE_SELECT_CUSTOM_ID = "setagem-membros:cargo";
const PANEL_TITLE = "Setagem de Membros";
const PANEL_DESCRIPTION = "Clique no botao abaixo para iniciar sua setagem.";
const PANEL_FOOTER = "Preencha nome, ID e o cargo desejado para enviar sua solicitacao.";
const BUTTON_LABEL = "Iniciar Setagem";
const MODAL_TITLE = "Formulario de Setagem";
const REVIEW_TITLE = "Nova solicitacao de setagem";
const REVIEW_FOOTER = "Revise os dados e escolha aceitar ou negar.";
const MAX_NAME_LENGTH = 20;
const MAX_PLAYER_ID_LENGTH = 8;

const decisionLocks = new Set();
const reviewRequests = new Map();

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function componentTreeHasCustomId(component, customId) {
  if (!component) {
    return false;
  }

  if (component.customId === customId || component.custom_id === customId) {
    return true;
  }

  if (component.accessory?.customId === customId || component.accessory?.custom_id === customId) {
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

function messageHasPanelButton(message) {
  return message.components.some((component) => componentTreeHasCustomId(component, OPEN_MODAL_CUSTOM_ID));
}

function truncate(value, maxLength) {
  const normalized = String(value || "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatDate(value) {
  return `<t:${Math.floor(value.getTime() / 1000)}:F>`;
}

function resolveRoles(config) {
  if (!Array.isArray(config.roles)) {
    return [];
  }

  return config.roles
    .filter((role) => role && typeof role === "object" && isSnowflake(role.roleId))
    .map((role) => {
      const grantRoleIds = Array.isArray(role.grantRoleIds)
        ? role.grantRoleIds.filter(isSnowflake)
        : [];

      return {
        roleId: role.roleId,
        grantRoleIds: grantRoleIds.length ? [...new Set(grantRoleIds)] : [role.roleId],
        label: truncate(role.label || role.name || "Cargo", 100),
        shortLabel: truncate(role.shortLabel || role.abbreviation || role.label || role.name || "Cargo", 20),
        description: role.description ? truncate(role.description, 100) : undefined,
        emoji: typeof role.emoji === "string" && role.emoji.trim() ? role.emoji.trim() : undefined
      };
    });
}

function resolveConfig(config) {
  return {
    panelChannelId: isSnowflake(config.panelChannelId) ? config.panelChannelId : null,
    reviewChannelId: isSnowflake(config.reviewChannelId) ? config.reviewChannelId : null,
    reviewerRoleId: isSnowflake(config.reviewerRoleId) ? config.reviewerRoleId : null,
    accentColor: Number.isInteger(config.accentColor) ? config.accentColor : 0x5865f2,
    approveColor: Number.isInteger(config.approveColor) ? config.approveColor : 0x57f287,
    denyColor: Number.isInteger(config.denyColor) ? config.denyColor : 0xed4245,
    bannerUrl: typeof config.bannerUrl === "string" && config.bannerUrl.trim() ? config.bannerUrl.trim() : null,
    roles: resolveRoles(config)
  };
}

function isConfigured(config) {
  return Boolean(config.panelChannelId && config.reviewChannelId && config.roles.length);
}

function findConfiguredRole(config, roleId) {
  return config.roles.find((role) => role.roleId === roleId) || null;
}

function buildPanel(config) {
  const container = new ContainerBuilder()
    .setAccentColor(config.accentColor)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${PANEL_TITLE}`),
          new TextDisplayBuilder().setContent(PANEL_DESCRIPTION)
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(OPEN_MODAL_CUSTOM_ID)
            .setLabel(BUTTON_LABEL)
            .setStyle(ButtonStyle.Primary)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder());

  if (config.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(config.bannerUrl)
      )
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(PANEL_FOOTER));

  return container;
}

function buildModal(config) {
  return new ModalBuilder()
    .setCustomId(SUBMIT_MODAL_CUSTOM_ID)
    .setTitle(MODAL_TITLE)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Nome")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(NAME_INPUT_CUSTOM_ID)
            .setPlaceholder("Ex: Joao Silva")
            .setRequired(true)
            .setMaxLength(MAX_NAME_LENGTH)
            .setStyle(TextInputStyle.Short)
        ),
      new LabelBuilder()
        .setLabel("ID")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(PLAYER_ID_INPUT_CUSTOM_ID)
            .setPlaceholder("Ex: 1024")
            .setRequired(true)
            .setMaxLength(MAX_PLAYER_ID_LENGTH)
            .setStyle(TextInputStyle.Short)
        ),
      new LabelBuilder()
        .setLabel("Cargo")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(ROLE_SELECT_CUSTOM_ID)
            .setPlaceholder("Selecione o cargo")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              config.roles.map((role) => ({
                label: role.label,
                value: role.roleId,
                description: role.description,
                emoji: role.emoji
              }))
            )
        )
    );
}

function buildDecisionCustomId(prefix, guildId, memberId, roleId) {
  return `${prefix}:${guildId}:${memberId}:${roleId}`;
}

function parseDecisionCustomId(customId, prefix) {
  if (!customId.startsWith(`${prefix}:`)) {
    return null;
  }

  const [, , guildId, memberId, roleId] = customId.split(":");

  if (!isSnowflake(guildId) || !isSnowflake(memberId) || !isSnowflake(roleId)) {
    return null;
  }

  return { guildId, memberId, roleId };
}

function buildReviewDetails({ member, nome, playerId, roleId, roleLabel, reviewer, decidedAt, decision, submittedAt }) {
  const lines = [
    `**Membro:** ${member ? `${member.user.tag} (${member})` : "Nao encontrado"}`,
    `**Discord ID:** ${member?.id || "Nao encontrado"}`,
    `**Nome enviado:** ${nome}`,
    `**ID enviado:** ${playerId}`,
    `**Cargo solicitado:** <@&${roleId}> (${roleLabel})`,
    `**Solicitado em:** ${formatDate(submittedAt || new Date())}`
  ];

  if (decision && reviewer && decidedAt) {
    lines.push(`**Status:** ${decision}`);
    lines.push(`**Responsavel:** ${reviewer}`);
    lines.push(`**Finalizado em:** ${formatDate(decidedAt)}`);
  }

  return lines.join("\n");
}

function buildReviewCard(config, payload) {
  const member = payload.member;
  const avatarUrl = member?.user.displayAvatarURL({ size: 256 }) || "https://cdn.discordapp.com/embed/avatars/0.png";
  const summary = payload.summary || `${member || "Um membro"} iniciou a setagem e aguarda revisao.`;
  const container = new ContainerBuilder()
    .setAccentColor(payload.accentColor)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${payload.title}`),
          new TextDisplayBuilder().setContent(summary)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(avatarUrl)
            .setDescription(`Avatar de ${member?.user?.tag || "membro"}`)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder());

  if (config.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(config.bannerUrl)
      )
    );
  }

  container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        buildReviewDetails({
          member,
          nome: payload.nome,
          playerId: payload.playerId,
          roleId: payload.roleId,
          roleLabel: payload.roleLabel,
          reviewer: payload.reviewer,
          decidedAt: payload.decidedAt,
          decision: payload.decision,
          submittedAt: payload.submittedAt
        })
      ),
      new TextDisplayBuilder().setContent(payload.footer)
    );

  return container;
}

function buildMemberNickname(roleShortLabel, nome, playerId) {
  return truncate(`[${String(roleShortLabel || "").trim() || "MEM"}] ${String(nome || "").trim()} | ${String(playerId || "").trim()}`, 32);
}

function normalizeMemberName(value) {
  return truncate(String(value || "").replace(/\s+/g, " ").trim(), MAX_NAME_LENGTH);
}

function normalizePlayerId(value) {
  return truncate(String(value || "").replace(/\s+/g, "").trim(), MAX_PLAYER_ID_LENGTH);
}

function buildReviewMessage(config, payload, pending) {
  const components = [
    buildReviewCard(config, payload)
  ];

  if (pending) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildDecisionCustomId(APPROVE_PREFIX, payload.guildId, payload.member.id, payload.roleId))
          .setLabel("Aceitar")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildDecisionCustomId(DENY_PREFIX, payload.guildId, payload.member.id, payload.roleId))
          .setLabel("Negar")
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return {
    components,
    flags: MessageFlags.IsComponentsV2
  };
}

async function fetchTextChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function ensurePanel(client, config) {
  if (!isConfigured(config)) {
    console.warn("[setagem-membros] Configure panelChannelId, reviewChannelId e roles.");
    return;
  }

  const channel = await fetchTextChannel(client, config.panelChannelId);

  if (!channel) {
    console.warn(`[setagem-membros] Canal de painel invalido: ${config.panelChannelId}.`);
    return;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const existingMessage = messages?.find(
    (message) => message.author.id === client.user.id && messageHasPanelButton(message)
  );

  const payload = {
    components: [buildPanel(config)],
    flags: MessageFlags.IsComponentsV2
  };

  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

function canReview(interaction, config) {
  if (!interaction.inGuild()) {
    return false;
  }

  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  if (config.reviewerRoleId && interaction.member.roles.cache.has(config.reviewerRoleId)) {
    return true;
  }

  return interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)
    || interaction.member.permissions.has(PermissionFlagsBits.KickMembers);
}

async function handleModalSubmit(interaction, client, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esta setagem so pode ser usada dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const nome = normalizeMemberName(interaction.fields.getTextInputValue(NAME_INPUT_CUSTOM_ID));
  const playerId = normalizePlayerId(interaction.fields.getTextInputValue(PLAYER_ID_INPUT_CUSTOM_ID));
  const [roleId] = interaction.fields.getStringSelectValues(ROLE_SELECT_CUSTOM_ID);
  const configuredRole = findConfiguredRole(config, roleId);

  if (!nome || !playerId || !configuredRole) {
    await interaction.reply({
      content: "Nao foi possivel validar os dados enviados.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reviewChannel = await fetchTextChannel(client, config.reviewChannelId);

  if (!reviewChannel || reviewChannel.guild?.id !== interaction.guildId) {
    await interaction.reply({
      content: "O canal de revisao nao esta configurado corretamente.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member) {
    await interaction.reply({
      content: "Nao consegui localizar seu perfil no servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const submittedAt = new Date();
  await reviewChannel.send(
    buildReviewMessage(
      config,
      {
        guildId: interaction.guildId,
        member,
        nome,
        playerId,
        roleId,
        roleLabel: configuredRole.label,
        title: REVIEW_TITLE,
        summary: `${member} iniciou a setagem e pediu o cargo <@&${roleId}>.`,
        footer: REVIEW_FOOTER,
        accentColor: config.accentColor,
        submittedAt
      },
      true
    )
  ).then((message) => {
    reviewRequests.set(message.id, {
      guildId: interaction.guildId,
      memberId: member.id,
      nome,
      playerId,
      roleId,
      roleLabel: configuredRole.label,
      submittedAt
    });
  });

  await interaction.reply({
    content: "Sua setagem foi enviada para revisao.",
    flags: MessageFlags.Ephemeral
  });
}

async function handleDecision(interaction, client, config, action) {
  const parsed = parseDecisionCustomId(
    interaction.customId,
    action === "approve" ? APPROVE_PREFIX : DENY_PREFIX
  );

  if (!parsed) {
    return;
  }

  if (!canReview(interaction, config)) {
    await interaction.reply({
      content: "Voce nao tem permissao para revisar esta setagem.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (decisionLocks.has(interaction.message.id)) {
    await interaction.reply({
      content: "Esta setagem ja esta sendo processada.",
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return;
  }

  decisionLocks.add(interaction.message.id);

  try {
    const configuredRole = findConfiguredRole(config, parsed.roleId);
    const guild = interaction.guild;
    const request = reviewRequests.get(interaction.message.id) || null;

    if (!guild || guild.id !== parsed.guildId || !configuredRole) {
      await interaction.reply({
        content: "Os dados desta solicitacao nao sao mais validos.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const targetMember = await guild.members.fetch(parsed.memberId).catch(() => null);

    if (!targetMember) {
      await interaction.reply({
        content: "O membro nao esta mais no servidor.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const rolesToGrant = [];

    for (const grantRoleId of configuredRole.grantRoleIds) {
      const resolvedRole = guild.roles.cache.get(grantRoleId) || await guild.roles.fetch(grantRoleId).catch(() => null);

      if (!resolvedRole) {
        await interaction.reply({
          content: "Um dos cargos configurados para esta setagem nao foi encontrado neste servidor.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      rolesToGrant.push(resolvedRole);
    }

    const primaryRole = rolesToGrant[0];

    if (!primaryRole) {
      await interaction.reply({
        content: "Nenhum cargo valido foi configurado para esta setagem.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const nome = request?.nome || "Nao informado";
    const playerId = request?.playerId || "Nao informado";
    const submittedAt = request?.submittedAt || new Date();
    const reviewer = `${interaction.user} (${interaction.user.tag})`;
    const decidedAt = new Date();
    const nickname = buildMemberNickname(configuredRole.shortLabel, nome, playerId);

    if (action === "approve") {
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles) || rolesToGrant.some((role) => !role.editable)) {
        await interaction.reply({
          content: "O bot nao consegue entregar um ou mais cargos desta setagem. Verifique a hierarquia e a permissao Manage Roles.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await targetMember.roles.add(rolesToGrant, `Setagem aprovada por ${interaction.user.tag}`);

      let nicknameApplied = false;

      if (guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames) && targetMember.manageable) {
        await targetMember.setNickname(nickname, `Padrao de setagem aprovado por ${interaction.user.tag}`);
        nicknameApplied = true;
      }

      await interaction.update(
        buildReviewMessage(
          config,
          {
            guildId: guild.id,
            member: targetMember,
            nome,
            playerId,
            roleId: primaryRole.id,
            roleLabel: configuredRole.label,
            title: "Setagem aprovada",
            summary: `${targetMember} recebeu ${rolesToGrant.length > 1 ? "os cargos" : "o cargo"} ${rolesToGrant.map((role) => `<@&${role.id}>`).join(", ")}.`,
            footer: nicknameApplied
              ? `Aprovado por ${reviewer}.`
              : `Aprovado por ${reviewer}. O bot nao conseguiu aplicar a renomeacao automatica.`,
            accentColor: config.approveColor,
            reviewer,
            decidedAt,
            decision: "Aprovada",
            submittedAt
          },
          false
        )
      );

      reviewRequests.delete(interaction.message.id);

      return;
    }

    if (!guild.members.me.permissions.has(PermissionFlagsBits.KickMembers) || !targetMember.kickable) {
      await interaction.reply({
        content: "O bot nao consegue expulsar este membro. Verifique a permissao Kick Members e a hierarquia.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await targetMember.kick(`Setagem negada por ${interaction.user.tag}`);

    await interaction.update(
      buildReviewMessage(
        config,
        {
          guildId: guild.id,
          member: targetMember,
          nome,
          playerId,
          roleId: primaryRole.id,
          roleLabel: configuredRole.label,
          title: "Setagem negada",
          summary: `${targetMember.user.tag} foi removido(a) do servidor apos a negacao.`,
          footer: `Negado por ${reviewer}.`,
          accentColor: config.denyColor,
          reviewer,
          decidedAt,
          decision: "Negada",
          submittedAt
        },
        false
      )
    );

    reviewRequests.delete(interaction.message.id);
  } finally {
    decisionLocks.delete(interaction.message.id);
  }
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);

  client.once(Events.ClientReady, async () => {
    await ensurePanel(client, resolvedConfig).catch((error) => {
      console.error("[setagem-membros] Falha ao preparar painel de setagem.", error);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId === OPEN_MODAL_CUSTOM_ID) {
      if (interaction.replied || interaction.deferred) {
        return;
      }

      try {
        await interaction.showModal(buildModal(resolvedConfig));
      } catch (error) {
        if (error?.code !== 40060) {
          console.error("[setagem-membros] Falha ao abrir modal.", error);
        }
      }

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === SUBMIT_MODAL_CUSTOM_ID) {
      try {
        await handleModalSubmit(interaction, client, resolvedConfig);
      } catch (error) {
        console.error("[setagem-membros] Falha ao enviar solicitacao.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel enviar sua setagem agora.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${APPROVE_PREFIX}:`)) {
      try {
        await handleDecision(interaction, client, resolvedConfig, "approve");
      } catch (error) {
        console.error("[setagem-membros] Falha ao aprovar setagem.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel aprovar esta setagem agora.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${DENY_PREFIX}:`)) {
      try {
        await handleDecision(interaction, client, resolvedConfig, "deny");
      } catch (error) {
        console.error("[setagem-membros] Falha ao negar setagem.", error);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Nao foi possivel negar esta setagem agora.",
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
