const fs = require("node:fs");
const path = require("node:path");

async function loadModules(client) {
  const modulesRoot = path.resolve(__dirname, "../../modules");

  if (!fs.existsSync(modulesRoot)) {
    return [];
  }

  const moduleFolders = fs.readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const loadedModules = [];

  for (const folderName of moduleFolders) {
    const modulePath = path.join(modulesRoot, folderName, "index.js");
    const configPath = path.join(modulesRoot, folderName, "config.json");

    if (!fs.existsSync(modulePath)) {
      console.warn(`Modulo ignorado em ${folderName}: arquivo index.js nao encontrado.`);
      continue;
    }

    let moduleDefinition;

    try {
      moduleDefinition = require(modulePath);
    } catch (error) {
      console.error(`Modulo ignorado em ${folderName}: falha ao carregar.`, error);
      continue;
    }

    const config = fs.existsSync(configPath) ? require(configPath) : {};

    if (typeof moduleDefinition.register !== "function") {
      console.warn(`Modulo ignorado em ${folderName}: register() nao encontrado.`);
      continue;
    }

    await moduleDefinition.register({ client, config, modulePath: path.join(modulesRoot, folderName) });
    loadedModules.push(folderName);
  }

  return loadedModules;
}

module.exports = {
  loadModules
};
