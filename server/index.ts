import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { AppError, requireCondition } from "./errors.js";
import {
  identity,
  ensureIdentity,
  registerAccount,
  loginAccount,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  changePassword,
  logout,
  mailEnabled,
  rateLimit,
  type Identity,
} from "./auth.js";
import {
  createRoom,
  joinRoom,
  roomView,
  watchRoom,
  publicRooms,
  applyRoomAction,
  heartbeat,
  transferHosts,
} from "./rooms.js";
import { games } from "./games/registry.js";
import {
  avatarRoomIds,
  publicAvatarUrl,
  removeAvatar,
  saveAvatar,
  verifyAvatarStore,
} from "./avatars.js";

const app = express();
app.disable("x-powered-by");
const avatarImageOrigin = config.avatar
  ? ` ${new URL(config.avatar.publicBaseUrl).origin}`
  : "";
const proxy = Number(process.env.TRUST_PROXY_HOPS || 0);
if (proxy > 0) app.set("trust proxy", proxy);
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:${avatarImageOrigin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  });
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
app.get("/api/me", async (req, res) => {
  const who = await ensureIdentity(req, res);
  const rooms = await pool.query(
    "SELECT DISTINCT r.id,r.code,r.game_id,r.status,r.updated_at FROM rooms r JOIN members m ON m.room_id=r.id JOIN players p ON p.id=m.player_id WHERE (p.id=$1 OR ($2::uuid IS NOT NULL AND p.user_id=$2)) AND r.status IN ('waiting','active') ORDER BY r.updated_at DESC LIMIT 10",
    [who.player_id, who.user_id],
  );
  res.json({
    id: who.player_id,
    name: who.name,
    isMember: !!who.user_id,
    loginId: who.login_id,
    email: who.email,
    emailVerified: who.email_verified,
    avatarUrl: publicAvatarUrl(who.avatar_key),
    avatarEnabled: !!config.avatar,
    csrf: who.csrf,
    rooms: rooms.rows,
    mailEnabled: mailEnabled(),
  });
});
app.get("/api/games", (_req, res) =>
  res.json([...games.values()].map((g) => g.info)),
);
app.use("/api", async (req, res, next) => {
  const who = await identity(req);
  requireCondition(who, 401, "連線身份已過期，請重新整理頁面。");
  res.locals.who = who;
  if (req.method !== "GET") {
    requireCondition(
      req.headers.origin === new URL(config.publicUrl).origin &&
        req.headers["x-csrf-token"] === who.csrf,
      403,
      "請從網站頁面操作。",
    );
    await rateLimit(`action:${who.player_id}`, 120, 60);
  }
  next();
});
const uuid = z.string().uuid();
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{8}$/);
const nickname = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, "暱稱不可包含控制字元");
const loginId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,23}$/);
const emailAddress = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const password = z.string().refine((value) => {
  const length = Array.from(value).length;
  return length >= 8 && length <= 128;
}, "密碼必須為 8–128 個字元");
const authToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
app.post("/api/profile", async (req, res) => {
  const { name } = z.object({ name: nickname }).parse(req.body);
  const who: Identity = res.locals.who;
  if (who.user_id) {
    await pool.query("UPDATE users SET display_name=$1 WHERE id=$2 AND NOT legacy", [
      name,
      who.user_id,
    ]);
    const rooms = await pool.query(
      "SELECT DISTINCT m.room_id FROM members m JOIN players p ON p.id=m.player_id JOIN rooms r ON r.id=m.room_id WHERE p.user_id=$1 AND r.status IN ('waiting','active')",
      [who.user_id],
    );
    void Promise.allSettled(rooms.rows.map((room) => broadcast(room.room_id)));
  } else {
    await pool.query("UPDATE players SET name=$1 WHERE id=$2", [
      name,
      who.player_id,
    ]);
  }
  res.json({ ok: true });
});
const avatarBody = express.raw({
  type: ["image/jpeg", "image/png", "image/webp"],
  limit: "5mb",
});
app.post("/api/profile/avatar", avatarBody, async (req, res) => {
  const who: Identity = res.locals.who;
  requireCondition(who.user_id, 401, "登入會員才能設定頭像。");
  requireCondition(
    Buffer.isBuffer(req.body),
    415,
    "只支援 JPEG、PNG 或 WebP 圖片。",
  );
  await rateLimit(`avatar:${who.user_id}`, 10, 3600);
  const avatarUrl = await saveAvatar(
    who.user_id,
    req.body,
    req.headers["content-type"]?.split(";", 1)[0].toLowerCase() || "",
  );
  const roomIds = await avatarRoomIds(who.user_id);
  res.json({ ok: true, avatarUrl });
  void Promise.allSettled(roomIds.map(broadcast));
});
app.delete("/api/profile/avatar", async (_req, res) => {
  const who: Identity = res.locals.who;
  requireCondition(who.user_id, 401, "登入會員才能設定頭像。");
  await rateLimit(`avatar:${who.user_id}`, 10, 3600);
  await removeAvatar(who.user_id);
  const roomIds = await avatarRoomIds(who.user_id);
  res.json({ ok: true, avatarUrl: null });
  void Promise.allSettled(roomIds.map(broadcast));
});
app.post("/api/auth/register", async (req, res) => {
  const values = z
    .object({
      loginId,
      displayName: nickname,
      email: emailAddress,
      password,
    })
    .parse(req.body);
  const who: Identity = res.locals.who;
  const verificationSent = await registerAccount(
    values,
    who,
    req.ip || "unknown",
    res,
  );
  closeSession(who.token_hash);
  res.json({ ok: true, verificationSent });
});
app.post("/api/auth/login", async (req, res) => {
  const values = z.object({ loginId, password }).parse(req.body);
  const who: Identity = res.locals.who;
  await loginAccount(
    values.loginId,
    values.password,
    who,
    req.ip || "unknown",
    res,
  );
  closeSession(who.token_hash);
  res.json({ ok: true });
});
app.post("/api/auth/verify-email", async (req, res) => {
  const { token } = z.object({ token: authToken }).parse(req.body);
  await verifyEmail(token);
  res.json({ ok: true });
});
app.post("/api/auth/resend-verification", async (req, res) => {
  const verificationSent = await resendVerification(
    res.locals.who,
    req.ip || "unknown",
  );
  res.json({ ok: true, verificationSent });
});
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = z.object({ email: emailAddress }).parse(req.body);
  await requestPasswordReset(email, req.ip || "unknown");
  res.json({ ok: true });
});
app.post("/api/auth/reset-password", async (req, res) => {
  const { token, newPassword } = z
    .object({ token: authToken, newPassword: password })
    .parse(req.body);
  const userId = await resetPassword(token, newPassword);
  closeUserSessions(userId);
  res.json({ ok: true });
});
app.post("/api/auth/change-password", async (req, res) => {
  const { currentPassword, newPassword } = z
    .object({ currentPassword: z.string(), newPassword: password })
    .parse(req.body);
  const who: Identity = res.locals.who;
  await changePassword(who, currentPassword, newPassword, res);
  closeUserSessions(who.user_id!);
  res.json({ ok: true });
});
app.post("/api/auth/logout", async (_req, res) => {
  const who: Identity = res.locals.who;
  await logout(who, res);
  closeSession(who.token_hash);
  res.json({ ok: true });
});
app.get("/api/history", async (_req, res) => {
  const who: Identity = res.locals.who;
  requireCondition(who.user_id, 401, "登入後即可查看戰績。");
  const rows = await pool.query(
    "SELECT r.match_id,r.score,r.won,m.game_id,m.finished_at FROM results r JOIN matches m ON m.id=r.match_id WHERE r.user_id=$1 ORDER BY m.finished_at DESC LIMIT 100",
    [who.user_id],
  );
  const summary = await pool.query(
    "SELECT count(*)::int AS played,count(*) FILTER (WHERE won)::int AS won FROM results WHERE user_id=$1",
    [who.user_id],
  );
  res.json({ matches: rows.rows, summary: summary.rows[0] });
});
app.post("/api/rooms", async (req, res) => {
  const { gameId, isPublic } = z
    .object({
      gameId: z.enum([...games.keys()] as [string, ...string[]]),
      isPublic: z.boolean().default(false),
    })
    .parse(req.body);
  await rateLimit(`create:${res.locals.who.player_id}`, 10, 3600);
  const id = await createRoom(res.locals.who, gameId, isPublic);
  res.json({ id });
  void broadcastLobby();
});
app.post("/api/rooms/join", async (req, res) => {
  const { code } = z.object({ code: roomCode }).parse(req.body);
  await rateLimit(`join:${res.locals.who.player_id}`, 30, 60);
  const id = await joinRoom(res.locals.who, code);
  closeSession(res.locals.who.token_hash);
  res.json({ id });
  void broadcast(id);
  void broadcastLobby();
});
app.get("/api/rooms/public", async (_req, res) =>
  res.json({ rooms: await publicRooms(spectatorCounts()) }),
);
app.get("/api/rooms/watch/:code", async (req, res) => {
  const who: Identity = res.locals.who;
  requireCondition(who.name !== "旅人", 403, "請先設定暱稱再開始旁觀。");
  await rateLimit(`watch:${who.player_id}`, 60, 60);
  const view = await watchRoom(
    roomCode.parse(req.params.code),
    who.player_id,
    spectatorIds,
  );
  const current = spectatorIds(view.id);
  requireCondition(
    current.includes(who.player_id) || current.length < 50,
    429,
    "這個房間已有 50 位旁觀者，請稍後再試。",
  );
  res.json(view);
});
app.get("/api/rooms/:id", async (req, res) =>
  res.json(
    await roomView(
      uuid.parse(req.params.id),
      res.locals.who.player_id,
      spectatorIds(uuid.parse(req.params.id)),
    ),
  ),
);
const roomAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), ready: z.boolean() }),
  z.object({ type: z.literal("start"), first: uuid.optional() }),
  z.object({ type: z.literal("setVisibility"), isPublic: z.boolean() }),
  z.object({ type: z.literal("returnToLobby") }),
  z.object({ type: z.literal("abort") }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("game"), action: z.unknown() }),
]);
app.post("/api/rooms/:id/actions", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z
    .object({
      operationId: uuid,
      version: z.number().int().min(0),
      action: roomAction,
    })
    .parse(req.body);
  const result = await applyRoomAction(
    id,
    res.locals.who,
    body.operationId,
    body.version,
    body.action,
  );
  res.json({ ok: true, ...result });
  void broadcast(id);
  void broadcastLobby();
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "找不到這個操作。" }),
);
app.use(express.static(resolve("dist/client"), { index: false }));
app.get("/{*path}", (_req, res) =>
  res.sendFile(resolve("dist/client/index.html")),
);
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res
      .status(400)
      .json({ error: "輸入格式不正確，請檢查帳號、名稱、Email、密碼或操作內容。" });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: "無效的請求格式。" });
    return;
  }
  if ((err as { type?: string })?.type === "entity.too.large") {
    res.status(413).json({ error: "圖片不可超過 5 MiB。" });
    return;
  }
  // Never log SQL parameters, state, email tokens or credentials.
  console.error("請求失敗", {
    code: (err as { code?: string })?.code || "INTERNAL_ERROR",
  });
  res.status(503).json({ error: "服務暫時無法使用，請稍後重新連線。" });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
interface PeerBase {
  ws: WebSocket;
  who: Identity;
  alive: boolean;
}
interface PlayerPeer extends PeerBase {
  kind: "room";
  role: "player";
  room: string;
}
interface SpectatorPeer extends PeerBase {
  kind: "room";
  role: "spectator";
  room: string;
  code: string;
}
interface LobbyPeer extends PeerBase {
  kind: "lobby";
}
type RoomPeer = PlayerPeer | SpectatorPeer;
type Peer = RoomPeer | LobbyPeer;
const peers = new Set<Peer>();
function spectatorIds(room: string) {
  return [
    ...new Set(
      [...peers]
        .filter(
          (peer): peer is SpectatorPeer =>
            peer.kind === "room" &&
            peer.role === "spectator" &&
            peer.room === room,
        )
        .map((peer) => peer.who.player_id),
    ),
  ];
}
function spectatorCounts() {
  const counts = new Map<string, Set<string>>();
  for (const peer of peers) {
    if (peer.kind !== "room" || peer.role !== "spectator") continue;
    const ids = counts.get(peer.room) || new Set<string>();
    ids.add(peer.who.player_id);
    counts.set(peer.room, ids);
  }
  return new Map([...counts].map(([room, ids]) => [room, ids.size]));
}
function closeSession(token: string) {
  for (const p of peers)
    if (p.who.token_hash === token) p.ws.close(4001, "session changed");
}
function closeUserSessions(userId: string) {
  for (const p of peers)
    if (p.who.user_id === userId) p.ws.close(4001, "account session changed");
}
async function sendRoomView(p: RoomPeer) {
  try {
    const view =
      p.role === "player"
        ? await roomView(p.room, p.who.player_id, spectatorIds(p.room))
        : await watchRoom(p.code, p.who.player_id, spectatorIds);
    if (p.ws.readyState === WebSocket.OPEN)
      p.ws.send(JSON.stringify({ type: "room", room: view }));
  } catch (e) {
    if (e instanceof AppError) p.ws.close(4003, "room unavailable");
    else if (p.ws.readyState === WebSocket.OPEN)
      p.ws.send(
        JSON.stringify({ type: "error", error: "同步暫時中斷，正在重試。" }),
      );
  }
}
async function sendLobby(p: LobbyPeer) {
  try {
    const rooms = await publicRooms(spectatorCounts());
    if (p.ws.readyState === WebSocket.OPEN)
      p.ws.send(JSON.stringify({ type: "publicRooms", rooms }));
  } catch {
    if (p.ws.readyState === WebSocket.OPEN)
      p.ws.send(
        JSON.stringify({ type: "error", error: "公開房清單暫時無法更新。" }),
      );
  }
}
async function sendPeer(peer: Peer) {
  return peer.kind === "lobby" ? sendLobby(peer) : sendRoomView(peer);
}
async function broadcast(id: string) {
  await Promise.allSettled(
    [...peers]
      .filter((peer): peer is RoomPeer => peer.kind === "room" && peer.room === id)
      .map(sendRoomView),
  );
}
async function broadcastLobby() {
  await Promise.allSettled(
    [...peers]
      .filter((peer): peer is LobbyPeer => peer.kind === "lobby")
      .map(sendLobby),
  );
}
function trackPeer(peer: Peer) {
  peers.add(peer);
  peer.ws.on("pong", () => {
    peer.alive = true;
    if (peer.kind === "room" && peer.role === "player")
      void heartbeat(peer.room, peer.who.player_id).catch(() => {});
  });
  peer.ws.on("error", () => peer.ws.terminate());
  peer.ws.on("close", () => {
    if (!peers.delete(peer)) return;
    if (peer.kind === "room" && peer.role === "spectator") {
      void broadcast(peer.room);
      void broadcastLobby();
    }
  });
  if (peer.kind === "lobby") void sendLobby(peer);
  else if (peer.role === "spectator") {
    void broadcast(peer.room);
    void broadcastLobby();
  } else {
    void heartbeat(peer.room, peer.who.player_id)
      .then(() => broadcast(peer.room))
      .catch(() => sendRoomView(peer));
  }
}
server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", config.publicUrl);
    requireCondition(
      url.pathname === "/ws" &&
        req.headers.origin === new URL(config.publicUrl).origin,
      403,
      "origin",
    );
    const who = await identity(req);
    requireCondition(who, 401, "session");
    requireCondition(
      [...peers].filter((p) => p.who.player_id === who.player_id).length < 6,
      429,
      "connections",
    );
    if (url.searchParams.get("lobby") === "1") {
      wss.handleUpgrade(req, socket, head, (ws) =>
        trackPeer({ kind: "lobby", ws, who, alive: true }),
      );
      return;
    }
    if (url.searchParams.get("mode") === "spectator") {
      requireCondition(who.name !== "旅人", 403, "nickname");
      await rateLimit(`watch-ws:${who.player_id}`, 60, 60);
      const code = roomCode.parse(url.searchParams.get("code"));
      const view = await watchRoom(code, who.player_id, spectatorIds);
      const current = spectatorIds(view.id);
      requireCondition(
        current.includes(who.player_id) || current.length < 50,
        429,
        "spectators",
      );
      wss.handleUpgrade(req, socket, head, (ws) =>
        trackPeer({
          kind: "room",
          role: "spectator",
          ws,
          room: view.id,
          code,
          who,
          alive: true,
        }),
      );
      return;
    }
    const room = uuid.parse(url.searchParams.get("room"));
    await roomView(room, who.player_id, spectatorIds(room));
    wss.handleUpgrade(req, socket, head, (ws) =>
      trackPeer({ kind: "room", role: "player", ws, room, who, alive: true }),
    );
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    for (const p of peers) {
      if (!p.alive) {
        p.ws.terminate();
        continue;
      }
      p.alive = false;
      p.ws.ping();
      const valid = await pool.query(
        "SELECT 1 FROM sessions WHERE token_hash=$1 AND player_id=$2 AND expires_at>now()",
        [p.who.token_hash, p.who.player_id],
      );
      if (!valid.rowCount) {
        p.ws.close(4001);
        continue;
      }
    }
    await transferHosts();
    await Promise.allSettled([...peers].map(sendPeer));
  } catch {
    for (const p of peers)
      if (p.ws.readyState === WebSocket.OPEN)
        p.ws.send(
          JSON.stringify({
            type: "error",
            error: "資料庫暫時離線，恢復後會重新同步。",
          }),
        );
  } finally {
    ticking = false;
  }
}, 15000);
timer.unref();
const cleanup = setInterval(() => {
  void pool
    .query("DELETE FROM rate_limits WHERE reset_at<now()-interval '1 day'")
    .then(() => pool.query("DELETE FROM sessions WHERE expires_at<now()"))
    .then(() =>
      pool.query(
        "DELETE FROM account_tokens WHERE expires_at<now()-interval '1 day'",
      ),
    )
    .catch(() => {});
}, 3600000);
cleanup.unref();
async function stop() {
  clearInterval(timer);
  clearInterval(cleanup);
  for (const p of peers) p.ws.close(1001);
  wss.close();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
if (process.env.AUTO_MIGRATE === "true") await migrate();
await pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
await verifyAvatarStore();
server.listen(config.port, "0.0.0.0", () =>
  console.info(`古楓桌遊 GFBG 服務啟動：http://localhost:${config.port}`),
);
