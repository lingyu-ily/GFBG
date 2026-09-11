import "dotenv/config";
const avatarEnvironment = {
  AVATAR_S3_ENDPOINT: process.env.AVATAR_S3_ENDPOINT,
  AVATAR_S3_REGION: process.env.AVATAR_S3_REGION,
  AVATAR_S3_BUCKET: process.env.AVATAR_S3_BUCKET,
  AVATAR_S3_ACCESS_KEY_ID: process.env.AVATAR_S3_ACCESS_KEY_ID,
  AVATAR_S3_SECRET_ACCESS_KEY: process.env.AVATAR_S3_SECRET_ACCESS_KEY,
  AVATAR_PUBLIC_BASE_URL: process.env.AVATAR_PUBLIC_BASE_URL,
};
const avatarValues = Object.values(avatarEnvironment);
const avatarConfigured = avatarValues.some(Boolean);
if (avatarConfigured && avatarValues.some((value) => !value)) {
  const missing = Object.entries(avatarEnvironment)
    .filter(([, value]) => !value)
    .map(([name]) => name)
    .join(", ");
  throw new Error(`頭像儲存設定不完整：${missing}`);
}
const avatar = avatarConfigured
  ? {
      endpoint: new URL(avatarEnvironment.AVATAR_S3_ENDPOINT!)
        .toString()
        .replace(/\/$/, ""),
      region: avatarEnvironment.AVATAR_S3_REGION!,
      bucket: avatarEnvironment.AVATAR_S3_BUCKET!,
      accessKeyId: avatarEnvironment.AVATAR_S3_ACCESS_KEY_ID!,
      secretAccessKey: avatarEnvironment.AVATAR_S3_SECRET_ACCESS_KEY!,
      publicBaseUrl: new URL(avatarEnvironment.AVATAR_PUBLIC_BASE_URL!)
        .toString()
        .replace(/\/$/, ""),
    }
  : null;
export const config = {
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || "http://localhost:5173").replace(
    /\/$/,
    "",
  ),
  databaseUrl: process.env.DATABASE_URL,
  production: process.env.NODE_ENV === "production",
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  },
  avatar,
};
if (!config.databaseUrl)
  throw new Error("請設定 DATABASE_URL（參考 .env.example）");
if (config.production && !config.publicUrl.startsWith("https://"))
  throw new Error("正式環境 PUBLIC_URL 必須使用 HTTPS");
if (
  config.production &&
  config.avatar &&
  !config.avatar.publicBaseUrl.startsWith("https://")
)
  throw new Error("正式環境 AVATAR_PUBLIC_BASE_URL 必須使用 HTTPS");
