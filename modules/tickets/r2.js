const path = require("node:path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const R2_BUCKET = process.env.R2_BUCKET || "lineuplabs";

let cachedClient;

function getRequiredEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function getR2Configuration() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("R2_SECRET_ACCESS_KEY");
  const bucket = getRequiredEnv("R2_BUCKET") || R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`
  };
}

function createR2Client() {
  const config = getR2Configuration();

  if (!config) {
    return null;
  }

  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

function getR2Client() {
  if (!cachedClient) {
    cachedClient = createR2Client();
  }

  return cachedClient;
}

function sanitizePathPart(value, fallback) {
  const normalized = String(value || fallback || "file")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

function buildObjectKey({ guildId, ticketId, messageId, attachmentId, fileName }) {
  const extension = path.extname(fileName || "");
  const baseName = path.basename(fileName || "arquivo", extension);
  const safeName = sanitizePathPart(baseName, "arquivo");
  const safeExtension = extension.replace(/[^\w.]/g, "").slice(0, 20);

  return [
    "transcripts",
    sanitizePathPart(guildId, "guild"),
    sanitizePathPart(ticketId, "ticket"),
    sanitizePathPart(messageId, "message"),
    `${sanitizePathPart(attachmentId, "attachment")}-${safeName}${safeExtension}`
  ].join("/");
}

async function uploadAttachmentToR2({ guildId, ticketId, messageId, attachment }) {
  const config = getR2Configuration();
  const client = getR2Client();

  if (!config || !client) {
    return null;
  }

  const response = await fetch(attachment.url);

  if (!response.ok) {
    throw new Error(`Falha ao baixar anexo ${attachment.id}: HTTP ${response.status}.`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const key = buildObjectKey({
    guildId,
    ticketId,
    messageId,
    attachmentId: attachment.id,
    fileName: attachment.name
  });

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: attachment.contentType || "application/octet-stream",
    ContentDisposition: `inline; filename="${encodeURIComponent(attachment.name || "arquivo")}"`,
    Metadata: {
      originalname: attachment.name || "arquivo",
      source: "discord-ticket-transcript"
    }
  }));

  return {
    provider: "r2",
    bucket: config.bucket,
    key
  };
}

module.exports = {
  getR2Configuration,
  uploadAttachmentToR2
};
