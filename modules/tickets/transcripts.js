const crypto = require("node:crypto");
const { OverwriteType } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const { uploadAttachmentToR2 } = require("./r2");

const DEFAULT_TABLE = "ticket_transcripts";
const PLACEHOLDER_BASE_URL = "https://seu-site.com";
const STAFF_MENU_BUTTON_ID = "tickets:staff-menu";
const LEAVE_TICKET_BUTTON_ID = "tickets:leave";

function createTranscriptClient() {
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

function getTranscriptConfigurationIssues(config = {}) {
  const issues = [];

  if (!process.env.SUPABASE_URL) {
    issues.push("SUPABASE_URL nao definido");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    issues.push("SUPABASE_SERVICE_ROLE_KEY nao definido");
  }

  const baseUrl = normalizeBaseUrl(config);

  if (!baseUrl) {
    issues.push("TICKET_TRANSCRIPT_BASE_URL nao definido");
  } else if (baseUrl === PLACEHOLDER_BASE_URL) {
    issues.push("TICKET_TRANSCRIPT_BASE_URL ainda esta com o valor de exemplo");
  }

  return issues;
}

function generatePassword() {
  return crypto.randomBytes(9).toString("base64url");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");

  return { salt, hash };
}

function normalizeBaseUrl(config) {
  const value = config.transcriptBaseUrl || process.env.TICKET_TRANSCRIPT_BASE_URL || process.env.WEBSITE_URL;

  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\/+$/g, "");

  if (normalized === PLACEHOLDER_BASE_URL) {
    return null;
  }

  return normalized;
}

function buildTranscriptUrl(config, guildId, ticketId) {
  const baseUrl = normalizeBaseUrl(config);

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/ticket/${guildId}/${ticketId}`;
}

function serializeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName || null,
    tag: user.tag,
    bot: Boolean(user.bot),
    avatarUrl: user.displayAvatarURL?.({ size: 128 }) || null
  };
}

function serializeAttachment(attachment, storage = null) {
  return {
    id: attachment.id,
    name: storage?.fileName || attachment.name,
    url: storage ? null : attachment.url,
    proxyUrl: storage ? null : (attachment.proxyURL || null),
    contentType: storage?.contentType || attachment.contentType || null,
    size: attachment.size || 0,
    storage
  };
}

function serializeEmbed(embed) {
  return {
    title: embed.title || null,
    description: embed.description || null,
    url: embed.url || null,
    color: embed.color || null,
    timestamp: embed.timestamp || null,
    image: embed.image?.url || null,
    thumbnail: embed.thumbnail?.url || null,
    fields: Array.isArray(embed.fields)
      ? embed.fields.map((field) => ({
        name: field.name,
        value: field.value,
        inline: Boolean(field.inline)
      }))
      : []
  };
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

function messageHasCustomId(message, customId) {
  return Array.isArray(message?.components)
    && message.components.some((component) => componentTreeHasCustomId(component, customId));
}

function shouldSkipTranscriptMessage(message) {
  return Boolean(
    message?.author?.bot
    && messageHasCustomId(message, STAFF_MENU_BUTTON_ID)
    && messageHasCustomId(message, LEAVE_TICKET_BUTTON_ID)
  );
}

async function fetchAllMessages(channel) {
  const messages = [];
  let before;

  for (;;) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });

    if (!batch.size) {
      break;
    }

    messages.push(...batch.values());
    before = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function collectParticipantIds(channel, messages, metadata) {
  const ids = new Set();

  if (metadata?.ownerId) {
    ids.add(metadata.ownerId);
  }

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.type === OverwriteType.Member) {
      ids.add(overwrite.id);
    }
  }

  for (const message of messages) {
    if (message.author && !message.author.bot) {
      ids.add(message.author.id);
    }
  }

  return [...ids].filter((id) => id && id !== channel.client.user.id);
}

async function buildTranscript(channel, metadata, closedBy) {
  const messages = await fetchAllMessages(channel);
  const participantIds = collectParticipantIds(channel, messages, metadata);

  const serializedMessages = [];

  for (const message of messages) {
    if (shouldSkipTranscriptMessage(message)) {
      continue;
    }

    const attachments = (await Promise.all(
      [...message.attachments.values()].map(async (attachment) => {
        if (!attachment.contentType?.startsWith("image/")) {
          return serializeAttachment(attachment);
        }

        let storage = null;

        try {
          storage = await uploadAttachmentToR2({
            guildId: channel.guild.id,
            ticketId: channel.id,
            messageId: message.id,
            attachment
          });
        } catch (error) {
          console.error(`[tickets] Falha ao enviar anexo ${attachment.id} para o R2.`, error);
        }

        return storage ? serializeAttachment(attachment, storage) : serializeAttachment(attachment);
      })
    )).filter(Boolean);

    serializedMessages.push({
      id: message.id,
      content: message.content || "",
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() || null,
      author: serializeUser(message.author),
      attachments,
      embeds: message.embeds.map(serializeEmbed),
      replyToId: message.reference?.messageId || null
    });
  }

  return {
    ticketId: channel.id,
    guildId: channel.guild.id,
    guildName: channel.guild.name,
    channelName: channel.name,
    ownerId: metadata?.ownerId || null,
    owner: metadata?.ownerId
      ? serializeUser(await channel.client.users.fetch(metadata.ownerId).catch(() => null))
      : null,
    ticketType: metadata?.ticketType || null,
    claimedBy: metadata?.claimedById
      ? serializeUser(await channel.client.users.fetch(metadata.claimedById).catch(() => null))
      : null,
    openedAt: metadata?.createdAt ? new Date(metadata.createdAt).toISOString() : null,
    closedAt: new Date().toISOString(),
    closedBy: serializeUser(closedBy),
    participants: participantIds,
    messages: serializedMessages
  };
}

async function saveTranscript(config, transcript) {
  const supabase = createTranscriptClient();

  if (!supabase) {
    throw new Error("Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }

  const password = generatePassword();
  const { salt, hash } = hashPassword(password);
  const table = config.transcriptTable || process.env.TICKET_TRANSCRIPT_TABLE || DEFAULT_TABLE;

  const payload = {
    guild_id: transcript.guildId,
    ticket_id: transcript.ticketId,
    channel_name: transcript.channelName,
    owner_id: transcript.ownerId,
    ticket_type: transcript.ticketType,
    closed_by_id: transcript.closedBy?.id || null,
    closed_at: transcript.closedAt,
    password_salt: salt,
    password_hash: hash,
    transcript
  };

  const { error } = await supabase
    .from(table)
    .upsert(payload, { onConflict: "guild_id,ticket_id" });

  if (error) {
    throw error;
  }

  return {
    password,
    url: buildTranscriptUrl(config, transcript.guildId, transcript.ticketId)
  };
}

module.exports = {
  buildTranscript,
  saveTranscript,
  getTranscriptConfigurationIssues
};
