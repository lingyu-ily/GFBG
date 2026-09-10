import "dotenv/config";
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
};
if (!config.databaseUrl)
  throw new Error("請設定 DATABASE_URL（參考 .env.example）");
if (config.production && !config.publicUrl.startsWith("https://"))
  throw new Error("正式環境 PUBLIC_URL 必須使用 HTTPS");
