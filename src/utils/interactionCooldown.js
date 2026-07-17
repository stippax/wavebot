const { MessageFlags } = require("discord.js");

const DEFAULT_COOLDOWN_MS = 2000;
const SWEEP_INTERVAL_MS = 60000;
const cooldowns = new Map();

let nextSweepAt = 0;

function sweepExpired(now) {
  if (now < nextSweepAt) {
    return;
  }

  nextSweepAt = now + SWEEP_INTERVAL_MS;

  for (const [key, expiresAt] of cooldowns) {
    if (expiresAt <= now) {
      cooldowns.delete(key);
    }
  }
}

function buildCooldownKey(interaction, scope) {
  const guildId = interaction.guildId || "dm";
  const channelId = interaction.channelId || "unknown-channel";
  const userId = interaction.user?.id || "unknown-user";
  const customId = interaction.customId || "unknown-component";

  return `${scope}:${guildId}:${channelId}:${userId}:${customId}`;
}

async function consumeInteractionCooldown(interaction, options = {}) {
  const now = Date.now();
  const cooldownMs = Number.isFinite(options.cooldownMs)
    ? Math.max(0, options.cooldownMs)
    : DEFAULT_COOLDOWN_MS;

  if (cooldownMs === 0) {
    return true;
  }

  sweepExpired(now);

  const key = buildCooldownKey(interaction, options.scope || "interaction");
  const expiresAt = cooldowns.get(key) || 0;

  if (expiresAt > now) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: options.message || "Aguarde um instante antes de usar este botao novamente.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }

    return false;
  }

  cooldowns.set(key, now + cooldownMs);
  return true;
}

module.exports = {
  consumeInteractionCooldown
};
