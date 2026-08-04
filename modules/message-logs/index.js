const {
  EmbedBuilder,
  Events
} = require("discord.js");

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function resolveSettings(config) {
  return {
    logChannelId: isSnowflake(config.logChannelId) ? config.logChannelId : null,
    ignoreBots: config.ignoreBots !== false,
    maxContentLength: Number.isInteger(config.maxContentLength) && config.maxContentLength > 0
      ? Math.min(config.maxContentLength, 1900)
      : 1000
  };
}

function truncateContent(value, maxLength) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "*Sem texto salvo.*";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatChannel(channelId) {
  return channelId ? `<#${channelId}>` : "Nao disponivel";
}

function formatMessageLink(message) {
  if (!message.guildId || !message.channelId || !message.id) {
    return "Nao disponivel";
  }

  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

async function resolveMessage(message) {
  if (!message?.partial) {
    return message;
  }

  try {
    return await message.fetch();
  } catch {
    return message;
  }
}

async function resolveLogChannel(client, settings) {
  if (!settings.logChannelId) {
    return null;
  }

  try {
    const channel = client.channels.cache.get(settings.logChannelId)
      || await client.channels.fetch(settings.logChannelId);
    return channel && channel.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

async function sendLog(client, settings, payload) {
  const channel = await resolveLogChannel(client, settings);

  if (!channel) {
    return;
  }

  await channel.send(payload).catch(() => {});
}

function buildDeleteEmbed(message, settings) {
  const attachmentCount = message.attachments?.size || 0;

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Mensagem apagada")
    .addFields(
      { name: "Autor", value: `${message.author} (\`${message.author?.tag || message.author?.id || "desconhecido"}\`)`, inline: true },
      { name: "Canal", value: formatChannel(message.channelId), inline: true },
      { name: "Anexos", value: String(attachmentCount), inline: true },
      { name: "Conteudo", value: truncateContent(message.content, settings.maxContentLength) },
      { name: "Link", value: formatMessageLink(message) }
    )
    .setTimestamp(new Date());
}

function buildUpdateEmbed(oldMessage, newMessage, settings) {
  const oldAttachmentCount = oldMessage.attachments?.size || 0;
  const newAttachmentCount = newMessage.attachments?.size || 0;

  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("Mensagem editada")
    .addFields(
      { name: "Autor", value: `${newMessage.author} (\`${newMessage.author?.tag || newMessage.author?.id || "desconhecido"}\`)`, inline: true },
      { name: "Canal", value: formatChannel(newMessage.channelId), inline: true },
      { name: "Anexos", value: `${oldAttachmentCount} -> ${newAttachmentCount}`, inline: true },
      { name: "Antes", value: truncateContent(oldMessage.content, settings.maxContentLength) },
      { name: "Depois", value: truncateContent(newMessage.content, settings.maxContentLength) },
      { name: "Link", value: formatMessageLink(newMessage) }
    )
    .setTimestamp(new Date());
}

async function register({ client, config }) {
  const settings = resolveSettings(config);

  client.on(Events.MessageDelete, async (message) => {
    const resolvedMessage = await resolveMessage(message);

    if (!resolvedMessage?.guildId || !resolvedMessage.author) {
      return;
    }

    if (settings.ignoreBots && resolvedMessage.author.bot) {
      return;
    }

    if (!resolvedMessage.content && !(resolvedMessage.attachments?.size)) {
      return;
    }

    await sendLog(client, settings, {
      embeds: [buildDeleteEmbed(resolvedMessage, settings)]
    });
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    const resolvedOldMessage = await resolveMessage(oldMessage);
    const resolvedNewMessage = await resolveMessage(newMessage);

    if (!resolvedNewMessage?.guildId || !resolvedNewMessage.author) {
      return;
    }

    if (settings.ignoreBots && resolvedNewMessage.author.bot) {
      return;
    }

    const oldContent = resolvedOldMessage?.content || "";
    const newContent = resolvedNewMessage.content || "";
    const oldAttachmentCount = resolvedOldMessage?.attachments?.size || 0;
    const newAttachmentCount = resolvedNewMessage.attachments?.size || 0;

    if (oldContent === newContent && oldAttachmentCount === newAttachmentCount) {
      return;
    }

    await sendLog(client, settings, {
      embeds: [buildUpdateEmbed(resolvedOldMessage || resolvedNewMessage, resolvedNewMessage, settings)]
    });
  });
}

module.exports = {
  register
};
