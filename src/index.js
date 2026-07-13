const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const envFiles = [".env.local", ".env"];

for (const envFile of envFiles) {
  const envPath = path.resolve(process.cwd(), envFile);

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

const { Client, Events, GatewayIntentBits, Partials } = require("discord.js");
const { loadModules } = require("./loaders/moduleLoader");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("A variavel DISCORD_TOKEN nao foi definida em .env.local ou .env.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.GuildMember,
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
  ]
});

async function bootstrap() {
  const loadedModules = await loadModules(client);
  client.loadedModules = loadedModules;

  client.once(Events.ClientReady, () => {
    console.log(`Bot conectado como ${client.user.tag}.`);
    console.log(`Modulos carregados: ${loadedModules.join(", ") || "nenhum"}.`);
  });

  await client.login(token);
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar o bot.", error);
  process.exit(1);
});
