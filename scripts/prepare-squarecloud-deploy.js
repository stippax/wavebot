const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const targetDir = path.join(projectRoot, ".squarecloud-deploy-temp");
const envCandidates = [".env.local", ".env"];
const includedEntries = ["modules", "src", "package.json", "package-lock.json", "squarecloud.app"];

function assertInsideProject(targetPath) {
  const relative = path.relative(projectRoot, targetPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Caminho fora do projeto: ${targetPath}`);
  }
}

function removeTargetDirectory() {
  assertInsideProject(targetDir);

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

function copyRecursive(sourcePath, targetPath) {
  const sourceStat = fs.statSync(sourcePath);

  if (sourceStat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });

    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(
        path.join(sourcePath, entry),
        path.join(targetPath, entry)
      );
    }

    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function resolveEnvSource() {
  for (const candidate of envCandidates) {
    const envPath = path.join(projectRoot, candidate);

    if (fs.existsSync(envPath)) {
      return envPath;
    }
  }

  return null;
}

function copyProjectFiles() {
  for (const entry of includedEntries) {
    const sourcePath = path.join(projectRoot, entry);
    const targetPath = path.join(targetDir, entry);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo ou pasta obrigatoria ausente: ${entry}`);
    }

    copyRecursive(sourcePath, targetPath);
  }
}

function writeEnvFile() {
  const envSource = resolveEnvSource();

  if (!envSource) {
    console.warn("[deploy] Nenhum arquivo .env.local ou .env encontrado. O pacote sera gerado sem .env.");
    return;
  }

  const targetEnvPath = path.join(targetDir, ".env");
  const envContent = fs.readFileSync(envSource, "utf8");
  fs.writeFileSync(targetEnvPath, envContent);

  console.log(`[deploy] Variaveis copiadas de ${path.basename(envSource)}.`);
}

function main() {
  removeTargetDirectory();
  fs.mkdirSync(targetDir, { recursive: true });
  copyProjectFiles();
  writeEnvFile();

  console.log(`[deploy] Pasta preparada em ${targetDir}.`);
}

main();
