const { createClient } = require("@supabase/supabase-js");
const {
  EmbedBuilder,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require("discord.js");

const TABLE_NAME = "bot_invites";
const RANKING_COMMAND_NAME = "rankingconvite";
const inviteSnapshots = new Map();
const guildQueues = new Map();

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function resolveColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^#/, "");
  return /^[\da-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : fallback;
}

function resolveConfig(config) {
  return {
    guildId: isSnowflake(config.guildId) ? config.guildId : null,
    logChannelId: isSnowflake(config.logChannelId) ? config.logChannelId : null,
    ignoreBots: config.ignoreBots !== false,
    logColor: resolveColor(config.logColor, 0x57f287),
    rankingColor: resolveColor(config.rankingColor, 0x5865f2)
  };
}

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function serializeInvite(invite) {
  return {
    code: invite.code,
    inviterId: invite.inviterId || invite.inviter?.id || null,
    maxUses: invite.maxUses || 0,
    uses: invite.uses || 0
  };
}

function serializeInvites(invites) {
  return new Map(invites.map((invite) => [invite.code, serializeInvite(invite)]));
}

async function fetchInviteSnapshot(guild) {
  const invites = await guild.invites.fetch();
  return serializeInvites(invites);
}

function detectUsedInvite(previous, current) {
  const increased = [...current.values()]
    .filter((invite) => invite.uses > (previous.get(invite.code)?.uses || 0))
    .sort((left, right) => {
      const leftDelta = left.uses - (previous.get(left.code)?.uses || 0);
      const rightDelta = right.uses - (previous.get(right.code)?.uses || 0);
      return rightDelta - leftDelta;
    });

  if (increased.length) {
    return increased[0];
  }

  // Convites de uso unico desaparecem assim que atingem o limite.
  const consumedInvite = [...previous.values()].find((invite) => (
    !current.has(invite.code)
    && invite.maxUses > 0
    && invite.uses + 1 >= invite.maxUses
  ));

  return consumedInvite ? { ...consumedInvite, uses: consumedInvite.uses + 1 } : null;
}

function queueForGuild(guildId, task) {
  const previous = guildQueues.get(guildId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  guildQueues.set(guildId, next);

  void next.then(() => {
    if (guildQueues.get(guildId) === next) {
      guildQueues.delete(guildId);
    }
  }, () => {
    if (guildQueues.get(guildId) === next) {
      guildQueues.delete(guildId);
    }
  });

  return next;
}

async function findUsedInvite(guild) {
  try {
    const current = await fetchInviteSnapshot(guild);
    const previous = inviteSnapshots.get(guild.id);

    if (!previous) {
      inviteSnapshots.set(guild.id, current);
      return null;
    }

    const usedInvite = detectUsedInvite(previous, current);
    inviteSnapshots.set(guild.id, current);
    return usedInvite;
  } catch (error) {
    console.warn(
      `[invites] Nao foi possivel consultar os convites de ${guild.name}. `
      + "Verifique se o bot possui a permissao Gerenciar Servidor.",
      error
    );
    return null;
  }
}

function buildJoinEmbed(member, inviter, invite, config) {
  const inviterMention = inviter ? `${inviter}` : (invite?.inviterId ? `<@${invite.inviterId}>` : null);
  const inviterText = inviterMention || "um convite que nao consegui identificar";
  const inviteCode = invite?.code || "desconhecido";
  const inviteUse = invite ? invite.uses : null;

  return new EmbedBuilder()
    .setColor(config.logColor)
    .setAuthor({
      name: "Novo membro a bordo!",
      iconURL: member.user.displayAvatarURL({ size: 128 })
    })
    .setDescription(`${member} acabou de entrar a bordo, convidado por ${inviterText}.`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: inviteUse === null
        ? `Convite: ${inviteCode}`
        : `Convite: ${inviteCode} • Uso nº ${inviteUse}`
    })
    .setTimestamp();
}

async function sendJoinLog(client, member, inviter, invite, config) {
  if (!config.logChannelId) {
    console.warn(`[invites] logChannelId nao configurado para a guild ${member.guild.name}.`);
    return;
  }

  try {
    const channel = await client.channels.fetch(config.logChannelId);

    if (!channel?.isTextBased()) {
      console.warn(`[invites] Canal de log ${config.logChannelId} invalido.`);
      return;
    }

    await channel.send({ embeds: [buildJoinEmbed(member, inviter, invite, config)] });
  } catch (error) {
    console.error("[invites] Falha ao enviar o log de convite.", error);
  }
}

async function saveInvite(storage, member, invite) {
  if (!invite?.inviterId) {
    return;
  }

  const { error } = await storage.from(TABLE_NAME).insert({
    guild_id: member.guild.id,
    inviter_id: invite.inviterId,
    invited_user_id: member.id,
    invite_code: invite.code,
    invite_uses: invite.uses || 1,
    joined_at: member.joinedAt?.toISOString() || new Date().toISOString()
  });

  // Um membro conta apenas uma vez por servidor, mesmo que saia e volte.
  if (error && error.code !== "23505") {
    throw error;
  }
}

function buildRankingEmbed(entries, config) {
  const medals = ["🥇", "🥈", "🥉"];
  const description = entries.length
    ? entries.map((entry, index) => (
        `${medals[index] || `**${index + 1}.**`} <@${entry.inviter_id}> — **${entry.invite_count}** convite${Number(entry.invite_count) === 1 ? "" : "s"}`
      )).join("\n")
    : "Ainda nao ha convites registrados neste servidor.";

  return new EmbedBuilder()
    .setColor(config.rankingColor)
    .setTitle("🏆 Ranking de Convites")
    .setDescription(description)
    .setFooter({ text: "Top 10 membros que mais trouxeram pessoas para a cidade" })
    .setTimestamp();
}

async function handleRanking(interaction, storage, config) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Esse comando so pode ser usado dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply();
  const { data, error } = await storage.rpc("get_bot_invite_ranking", {
    target_guild_id: interaction.guildId,
    result_limit: 10
  });

  if (error) {
    throw error;
  }

  await interaction.editReply({ embeds: [buildRankingEmbed(data || [], config)] });
}

function getCommands(config) {
  const resolvedConfig = resolveConfig(config);
  const command = new SlashCommandBuilder()
    .setName(RANKING_COMMAND_NAME)
    .setDescription("Mostra os 10 membros que mais convidaram pessoas para a cidade.");

  return [{ command: command.toJSON(), guildId: resolvedConfig.guildId }];
}

async function register({ client, config }) {
  const resolvedConfig = resolveConfig(config);
  const storage = createSupabaseClient();

  if (!storage) {
    throw new Error("[invites] Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }

  client.once(Events.ClientReady, async () => {
    const guild = client.guilds.cache.get(resolvedConfig.guildId);

    if (!guild) {
      return;
    }

    try {
      inviteSnapshots.set(guild.id, await fetchInviteSnapshot(guild));
      console.log(`[invites] ${inviteSnapshots.get(guild.id).size} convite(s) carregado(s) em ${guild.name}.`);
    } catch (error) {
      console.warn(
        `[invites] Nao foi possivel carregar os convites de ${guild.name}. `
        + "Verifique a permissao Gerenciar Servidor.",
        error
      );
    }
  });

  client.on(Events.InviteCreate, (invite) => {
    if (resolvedConfig.guildId && invite.guild?.id !== resolvedConfig.guildId) {
      return;
    }

    const snapshot = inviteSnapshots.get(invite.guild?.id);
    if (snapshot) {
      snapshot.set(invite.code, serializeInvite(invite));
    }
  });

  client.on(Events.InviteDelete, (invite) => {
    if (resolvedConfig.guildId && invite.guild?.id !== resolvedConfig.guildId) {
      return;
    }

    // Mantemos convites expirados no snapshot ate o proximo GuildMemberAdd para
    // identificar corretamente convites de uso unico.
    if (invite.guild?.id && !inviteSnapshots.has(invite.guild.id)) {
      inviteSnapshots.set(invite.guild.id, new Map());
    }
  });

  client.on(Events.GuildMemberAdd, (member) => {
    if (resolvedConfig.guildId && member.guild.id !== resolvedConfig.guildId) {
      return;
    }

    void queueForGuild(member.guild.id, async () => {
      const invite = await findUsedInvite(member.guild);

      if (resolvedConfig.ignoreBots && member.user.bot) {
        return;
      }

      const inviter = invite?.inviterId
        ? await member.guild.members.fetch(invite.inviterId).catch(() => null)
        : null;

      try {
        await saveInvite(storage, member, invite);
      } catch (error) {
        console.error("[invites] Falha ao salvar o convite no Supabase.", error);
      }

      await sendJoinLog(client, member, inviter, invite, resolvedConfig);
    }).catch((error) => {
      console.error("[invites] Falha inesperada ao processar uma entrada.", error);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== RANKING_COMMAND_NAME) {
      return;
    }

    if (resolvedConfig.guildId && interaction.guildId !== resolvedConfig.guildId) {
      return;
    }

    try {
      await handleRanking(interaction, storage, resolvedConfig);
    } catch (error) {
      console.error("[invites] Falha ao gerar o ranking.", error);
      const payload = { content: "Nao foi possivel gerar o ranking de convites agora." };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
}

module.exports = {
  getCommands,
  register
};
