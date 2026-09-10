import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Request, Response } from "express";
import nodemailer from "nodemailer";
import type pg from "pg";
import { pool, transaction } from "./db.js";
import { config } from "./config.js";
import { requireCondition } from "./errors.js";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
export interface Identity {
  token_hash: string;
  player_id: string;
  csrf: string;
  name: string;
  user_id: string | null;
  email: string | null;
}
export function sessionCookie(req: Pick<Request, "headers">) {
  const raw = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("bgs_session="))
    ?.slice(12);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? hash(raw) : null;
}
export async function identity(
  req: Pick<Request, "headers">,
): Promise<Identity | null> {
  const key = sessionCookie(req);
  if (!key) return null;
  return (
    (
      await pool.query(
        "SELECT s.token_hash,s.player_id,s.csrf,p.name,p.user_id,u.email FROM sessions s JOIN players p ON p.id=s.player_id LEFT JOIN users u ON u.id=p.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [key],
      )
    ).rows[0] || null
  );
}
function setCookie(res: Response, value: string) {
  res.cookie("bgs_session", value, {
    httpOnly: true,
    secure: config.publicUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400000,
  });
}
export async function issueSession(db: pg.PoolClient, player: string) {
  const token = secret();
  const csrf = secret();
  await db.query(
    "INSERT INTO sessions(token_hash,player_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
    [hash(token), player, csrf],
  );
  return { token, csrf };
}
export async function ensureIdentity(req: Request, res: Response) {
  const found = await identity(req);
  if (found) return found;
  await rateLimit(`guest:${req.ip}`, 30, 3600);
  const id = randomUUID();
  const session = await transaction(async (db) => {
    await db.query("INSERT INTO players(id,name) VALUES($1,'旅人')", [id]);
    return issueSession(db, id);
  });
  setCookie(res, session.token);
  return {
    token_hash: hash(session.token),
    player_id: id,
    csrf: session.csrf,
    name: "旅人",
    user_id: null,
    email: null,
  };
}
export async function rateLimit(key: string, max: number, seconds: number) {
  const r = await pool.query(
    `INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+($2 * interval '1 second'))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at<=now() THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count`,
    [hash(key), seconds],
  );
  requireCondition(r.rows[0].count <= max, 429, "操作太頻繁，請稍後再試。");
}
const mailer =
  config.smtp.host && config.smtp.from
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        requireTLS: !config.smtp.secure && process.env.NODE_ENV !== "test",
        auth: config.smtp.user
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      })
    : null;
export async function requestLogin(email: string, who: Identity, ip: string) {
  requireCondition(mailer, 503, "Email 登入尚未設定，仍可用訪客身分遊玩。");
  await rateLimit(`mail-ip:${ip}`, 10, 3600);
  await rateLimit(`mail-email:${email}`, 1, 60);
  const token = secret();
  await pool.query(
    "INSERT INTO login_tokens(token_hash,player_id,email,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes')",
    [hash(token), who.player_id, email],
  );
  // Fragment avoids proxy/access-log token leakage. GET never consumes the token.
  const url = `${config.publicUrl}/auth/confirm#token=${token}`;
  try {
    await mailer.sendMail({
      from: config.smtp.from,
      to: email,
      subject: "古楓桌遊｜你的登入連結",
      text: `在提出登入要求的同一瀏覽器開啟此連結，按「確認登入」：\n${url}\n\n連結 15 分鐘內有效，僅能使用一次。若不是你提出要求，請忽略此信。`,
    });
  } catch {
    await pool.query("DELETE FROM login_tokens WHERE token_hash=$1", [
      hash(token),
    ]);
    throw new Error("SMTP_SEND_FAILED");
  }
}
export async function confirmLogin(
  token: string,
  who: Identity,
  res: Response,
) {
  const session = await transaction(async (db) => {
    const {
      rows: [link],
    } = await db.query(
      "SELECT * FROM login_tokens WHERE token_hash=$1 FOR UPDATE",
      [hash(token)],
    );
    requireCondition(
      link &&
        !link.consumed_at &&
        new Date(link.expires_at).getTime() > Date.now(),
      400,
      "登入連結無效、已使用或已過期，請重新索取。",
    );
    requireCondition(
      link.player_id === who.player_id,
      400,
      "請使用原本要求登入的瀏覽器開啟連結，以保留你的座位。",
    );
    await db.query(
      "INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO NOTHING",
      [randomUUID(), link.email],
    );
    const user = (
      await db.query("SELECT id FROM users WHERE email=$1 FOR UPDATE", [
        link.email,
      ])
    ).rows[0];
    const player = (
      await db.query("SELECT user_id FROM players WHERE id=$1 FOR UPDATE", [
        who.player_id,
      ])
    ).rows[0];
    requireCondition(
      !player.user_id || player.user_id === user.id,
      409,
      "切換帳號前請先登出。",
    );
    // Serialize with room membership changes before attributing any in-flight match.
    const current = await db.query(
      "SELECT r.id FROM rooms r JOIN members m ON m.room_id=r.id WHERE m.player_id=$1 AND r.status IN ('waiting','active') ORDER BY r.id FOR UPDATE OF r",
      [who.player_id],
    );
    for (const room of current.rows) {
      const duplicate = await db.query(
        "SELECT 1 FROM members m JOIN players p ON p.id=m.player_id WHERE m.room_id=$1 AND p.user_id=$2 AND p.id<>$3",
        [room.id, user.id, who.player_id],
      );
      requireCondition(
        !duplicate.rowCount,
        409,
        "此帳號已在同一房間有另一個座位，請先離開目前房間。",
      );
    }
    await db.query("UPDATE players SET user_id=$1 WHERE id=$2", [
      user.id,
      who.player_id,
    ]);
    await db.query(
      "UPDATE login_tokens SET consumed_at=now() WHERE token_hash=$1",
      [hash(token)],
    );
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      who.token_hash,
    ]);
    return issueSession(db, who.player_id);
  });
  setCookie(res, session.token);
}
export async function logout(who: Identity, res: Response) {
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
    who.token_hash,
  ]);
  res.clearCookie("bgs_session", { path: "/" });
}
