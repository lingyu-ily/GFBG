import {
  argon2,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import nodemailer from "nodemailer";
import type pg from "pg";
import { pool, transaction } from "./db.js";
import { config } from "./config.js";
import { requireCondition } from "./errors.js";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

export interface Identity {
  token_hash: string;
  player_id: string;
  csrf: string;
  name: string;
  user_id: string | null;
  login_id: string | null;
  email: string | null;
  email_verified: boolean;
  avatar_key: string | null;
}

interface Account {
  id: string;
  login_id: string;
  display_name: string;
  email: string;
  email_verified_at: Date | null;
  password_digest: string;
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
        `SELECT s.token_hash,s.player_id,s.csrf,
          coalesce(u.display_name,p.name) AS name,u.id AS user_id,
          u.login_id,u.email,(u.email_verified_at IS NOT NULL) AS email_verified,
          u.avatar_key
        FROM sessions s
        JOIN players p ON p.id=s.player_id
        LEFT JOIN users u ON u.id=p.user_id AND NOT u.legacy
        WHERE s.token_hash=$1 AND s.expires_at>now()`,
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
    login_id: null,
    email: null,
    email_verified: false,
    avatar_key: null,
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

export const mailEnabled = () => !!mailer;

function derivePassword(password: string, salt: Buffer, parameters = ARGON) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      "argon2id",
      { message: password, nonce: salt, ...parameters },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });
}

export async function passwordDigest(password: string) {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, digest: string) {
  const matched = digest.match(
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/,
  );
  if (!matched) return false;
  const expected = Buffer.from(matched[5], "base64url");
  const actual = await derivePassword(password, Buffer.from(matched[4], "base64url"), {
    memory: Number(matched[1]),
    passes: Number(matched[2]),
    parallelism: Number(matched[3]),
    tagLength: expected.length,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function claimAccount(
  db: pg.PoolClient,
  who: Identity,
  account: Pick<Account, "id" | "display_name">,
) {
  const player = (
    await db.query("SELECT user_id FROM players WHERE id=$1 FOR UPDATE", [
      who.player_id,
    ])
  ).rows[0];
  requireCondition(!player.user_id, 409, "切換帳號前請先登出。");
  const current = await db.query(
    "SELECT r.id FROM rooms r JOIN members m ON m.room_id=r.id WHERE m.player_id=$1 AND r.status IN ('waiting','active') ORDER BY r.id FOR UPDATE OF r",
    [who.player_id],
  );
  for (const room of current.rows) {
    const duplicate = await db.query(
      "SELECT 1 FROM members m JOIN players p ON p.id=m.player_id WHERE m.room_id=$1 AND p.user_id=$2 AND p.id<>$3",
      [room.id, account.id, who.player_id],
    );
    requireCondition(
      !duplicate.rowCount,
      409,
      "此帳號已在同一房間有另一個座位，請先離開目前房間。",
    );
  }
  await db.query("UPDATE players SET user_id=$1,name=$2 WHERE id=$3", [
    account.id,
    account.display_name,
    who.player_id,
  ]);
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [who.token_hash]);
  return issueSession(db, who.player_id);
}

type MailPurpose = "verify_email" | "reset_password";

async function sendAccountMail(
  userId: string,
  email: string,
  purpose: MailPurpose,
) {
  if (!mailer) return false;
  const token = secret();
  const seconds = purpose === "verify_email" ? 86400 : 1800;
  await transaction(async (db) => {
    await db.query(
      "DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
      [userId, purpose],
    );
    await db.query(
      "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+($4 * interval '1 second'))",
      [hash(token), userId, purpose, seconds],
    );
  });
  const verification = purpose === "verify_email";
  const url = `${config.publicUrl}/auth/${verification ? "verify-email" : "reset-password"}#token=${token}`;
  try {
    await mailer.sendMail({
      from: config.smtp.from,
      to: email,
      subject: verification
        ? "古楓桌遊｜驗證你的 Email"
        : "古楓桌遊｜重設你的密碼",
      text: verification
        ? `開啟此連結驗證 Email：\n${url}\n\n連結 24 小時內有效，僅能使用一次。驗證不會讓這個瀏覽器登入。若不是你提出要求，請忽略此信。`
        : `開啟此連結設定新密碼：\n${url}\n\n連結 30 分鐘內有效，僅能使用一次。若不是你提出要求，請忽略此信。`,
    });
    return true;
  } catch {
    await pool.query("DELETE FROM account_tokens WHERE token_hash=$1", [
      hash(token),
    ]);
    return false;
  }
}

export async function registerAccount(
  values: {
    loginId: string;
    displayName: string;
    email: string;
    password: string;
  },
  who: Identity,
  ip: string,
  res: Response,
) {
  requireCondition(!who.user_id, 409, "你已登入帳號。");
  await rateLimit(`register-ip:${ip}`, 10, 3600);
  await rateLimit(`register-login:${values.loginId}`, 5, 3600);
  await rateLimit(`register-email:${values.email}`, 5, 3600);
  const digest = await passwordDigest(values.password);
  const account = await transaction(async (db) => {
    const created = await db.query<Account>(
      `INSERT INTO users(id,email,login_id,display_name,password_digest,legacy)
       VALUES($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING
       RETURNING id,email,login_id,display_name,password_digest,email_verified_at`,
      [randomUUID(), values.email, values.loginId, values.displayName, digest],
    );
    requireCondition(
      created.rowCount === 1,
      409,
      "登入帳號或 Email 已被使用。",
    );
    const account = created.rows[0];
    const session = await claimAccount(db, who, account);
    setCookie(res, session.token);
    return account;
  });
  return sendAccountMail(account.id, account.email, "verify_email");
}

export async function loginAccount(
  loginId: string,
  password: string,
  who: Identity,
  ip: string,
  res: Response,
) {
  requireCondition(!who.user_id, 409, "你已登入帳號。");
  await rateLimit(`login-ip:${ip}`, 30, 900);
  await rateLimit(`login-id:${loginId}`, 10, 900);
  const account = (
    await pool.query<Account>(
      "SELECT id,email,login_id,display_name,password_digest,email_verified_at FROM users WHERE login_id=$1 AND NOT legacy",
      [loginId],
    )
  ).rows[0];
  const valid = account
    ? await verifyPassword(password, account.password_digest)
    : (await passwordDigest(password), false);
  requireCondition(valid, 401, "登入帳號或密碼不正確。");
  const session = await transaction(async (db) => {
    const locked = (
      await db.query<{ password_digest: string }>(
        "SELECT password_digest FROM users WHERE id=$1 AND NOT legacy FOR UPDATE",
        [account.id],
      )
    ).rows[0];
    requireCondition(
      locked?.password_digest === account.password_digest,
      401,
      "登入帳號或密碼不正確。",
    );
    return claimAccount(db, who, account);
  });
  setCookie(res, session.token);
}

export async function verifyEmail(token: string) {
  await transaction(async (db) => {
    const link = (
      await db.query(
        "SELECT * FROM account_tokens WHERE token_hash=$1 AND purpose='verify_email' FOR UPDATE",
        [hash(token)],
      )
    ).rows[0];
    requireCondition(
      link && !link.consumed_at && new Date(link.expires_at).getTime() > Date.now(),
      400,
      "驗證連結無效、已使用或已過期，請重新寄送。",
    );
    await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      link.user_id,
    ]);
    await db.query("UPDATE account_tokens SET consumed_at=now() WHERE token_hash=$1", [
      hash(token),
    ]);
  });
}

export async function resendVerification(who: Identity, ip: string) {
  requireCondition(who.user_id && who.email, 401, "請先登入帳號。");
  requireCondition(!who.email_verified, 409, "Email 已完成驗證。");
  await rateLimit(`verify-ip:${ip}`, 10, 3600);
  await rateLimit(`verify-user:${who.user_id}`, 3, 3600);
  return sendAccountMail(who.user_id, who.email, "verify_email");
}

export async function requestPasswordReset(email: string, ip: string) {
  await rateLimit(`reset-ip:${ip}`, 10, 3600);
  await rateLimit(`reset-email:${email}`, 3, 3600);
  const account = (
    await pool.query<{ id: string; email: string }>(
      "SELECT id,email FROM users WHERE lower(email)=$1 AND NOT legacy AND email_verified_at IS NOT NULL",
      [email],
    )
  ).rows[0];
  if (account) await sendAccountMail(account.id, account.email, "reset_password");
}

export async function resetPassword(token: string, password: string) {
  const digest = await passwordDigest(password);
  return transaction(async (db) => {
    const link = (
      await db.query(
        "SELECT * FROM account_tokens WHERE token_hash=$1 AND purpose='reset_password' FOR UPDATE",
        [hash(token)],
      )
    ).rows[0];
    requireCondition(
      link && !link.consumed_at && new Date(link.expires_at).getTime() > Date.now(),
      400,
      "重設連結無效、已使用或已過期，請重新申請。",
    );
    await db.query("UPDATE users SET password_digest=$1 WHERE id=$2 AND NOT legacy", [
      digest,
      link.user_id,
    ]);
    await db.query("UPDATE account_tokens SET consumed_at=now() WHERE token_hash=$1", [
      hash(token),
    ]);
    await db.query(
      "DELETE FROM sessions s USING players p WHERE s.player_id=p.id AND p.user_id=$1",
      [link.user_id],
    );
    return link.user_id as string;
  });
}

export async function changePassword(
  who: Identity,
  currentPassword: string,
  newPassword: string,
  res: Response,
) {
  requireCondition(who.user_id, 401, "請先登入帳號。");
  const account = (
    await pool.query<{ password_digest: string }>(
      "SELECT password_digest FROM users WHERE id=$1 AND NOT legacy",
      [who.user_id],
    )
  ).rows[0];
  requireCondition(
    account && (await verifyPassword(currentPassword, account.password_digest)),
    401,
    "目前密碼不正確。",
  );
  const digest = await passwordDigest(newPassword);
  const session = await transaction(async (db) => {
    const locked = (
      await db.query<{ password_digest: string }>(
        "SELECT password_digest FROM users WHERE id=$1 AND NOT legacy FOR UPDATE",
        [who.user_id],
      )
    ).rows[0];
    requireCondition(
      locked?.password_digest === account.password_digest,
      409,
      "密碼已在其他裝置更新，請重新登入。",
    );
    await db.query("UPDATE users SET password_digest=$1 WHERE id=$2", [
      digest,
      who.user_id,
    ]);
    await db.query(
      "DELETE FROM sessions s USING players p WHERE s.player_id=p.id AND p.user_id=$1",
      [who.user_id],
    );
    return issueSession(db, who.player_id);
  });
  setCookie(res, session.token);
}

export async function logout(who: Identity, res: Response) {
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [who.token_hash]);
  res.clearCookie("bgs_session", { path: "/" });
}
