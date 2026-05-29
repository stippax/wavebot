require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { loadModules } = require("./loaders/moduleLoader");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("A variavel DISCORD_TOKEN nao foi definida no arquivo .env.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

async function bootstrap() {
  const loadedModules = await loadModules(client);
  client.loadedModules = loadedModules;

  client.once("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}.`);
    console.log(`Modulos carregados: ${loadedModules.join(", ") || "nenhum"}.`);
  });

  await client.login(token);
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar o bot.", error);
  process.exit(1);
});
