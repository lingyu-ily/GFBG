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
  requestLogin,
  confirmLogin,
  logout,
  rateLimit,
  type Identity,
} from "./auth.js";
import {
  createRoom,
  joinRoom,
  roomView,
  applyRoomAction,
  heartbeat,
  transferHosts,
} from "./rooms.js";
import { games } from "./games/registry.js";

const app = express();
app.disable("x-powered-by");
const proxy = Number(process.env.TRUST_PROXY_HOPS || 0);
if (proxy > 0) app.set("trust proxy", proxy);
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
    email: who.email,
    csrf: who.csrf,
    rooms: rooms.rows,
    emailEnabled: !!(config.smtp.host && config.smtp.from),
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
const nickname = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, "暱稱不可包含控制字元");
app.post("/api/profile", async (req, res) => {
  const { name } = z.object({ name: nickname }).parse(req.body);
  await pool.query("UPDATE players SET name=$1 WHERE id=$2", [
    name,
    res.locals.who.player_id,
  ]);
  res.json({ ok: true });
});
app.post("/api/auth/request", async (req, res) => {
  const { email } = z
    .object({
      email: z
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
    })
    .parse(req.body);
  await requestLogin(email, res.locals.who, req.ip || "unknown");
  res.json({ ok: true });
});
app.post("/api/auth/confirm", async (req, res) => {
  const { token } = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .parse(req.body);
  const who: Identity = res.locals.who;
  await confirmLogin(token, who, res);
  closeSession(who.token_hash);
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
  const { gameId } = z
    .object({ gameId: z.enum([...games.keys()] as [string, ...string[]]) })
    .parse(req.body);
  await rateLimit(`create:${res.locals.who.player_id}`, 10, 3600);
  res.json({ id: await createRoom(res.locals.who, gameId) });
});
app.post("/api/rooms/join", async (req, res) => {
  const { code } = z
    .object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-HJ-NP-Z2-9]{8}$/),
    })
    .parse(req.body);
  await rateLimit(`join:${res.locals.who.player_id}`, 30, 60);
  const id = await joinRoom(res.locals.who, code);
  closeSession(res.locals.who.token_hash);
  res.json({ id });
  void broadcast(id);
});
app.get("/api/rooms/:id", async (req, res) =>
  res.json(await roomView(uuid.parse(req.params.id), res.locals.who.player_id)),
);
const roomAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), ready: z.boolean() }),
  z.object({ type: z.literal("start"), first: uuid.optional() }),
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
      .json({ error: "輸入格式不正確，請檢查暱稱、代碼或操作內容。" });
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
  if (err instanceof Error && err.message === "SMTP_SEND_FAILED") {
    res
      .status(503)
      .json({ error: "驗證信寄送失敗，請稍後重試；你仍可用訪客遊玩。" });
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
interface Peer {
  ws: WebSocket;
  room: string;
  who: Identity;
  alive: boolean;
}
const peers = new Set<Peer>();
function closeSession(token: string) {
  for (const p of peers)
    if (p.who.token_hash === token) p.ws.close(4001, "session changed");
}
async function sendView(p: Peer) {
  try {
    const view = await roomView(p.room, p.who.player_id);
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
async function broadcast(id: string) {
  await Promise.allSettled(
    [...peers].filter((p) => p.room === id).map(sendView),
  );
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
    const room = uuid.parse(url.searchParams.get("room"));
    const who = await identity(req);
    requireCondition(who, 401, "session");
    requireCondition(
      [...peers].filter((p) => p.who.player_id === who.player_id).length < 6,
      429,
      "connections",
    );
    await roomView(room, who.player_id);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer: Peer = { ws, room, who, alive: true };
      peers.add(peer);
      ws.on("pong", () => {
        peer.alive = true;
        void heartbeat(room, who.player_id).catch(() => {});
      });
      ws.on("error", () => ws.terminate());
      ws.on("close", () => peers.delete(peer));
      void heartbeat(room, who.player_id)
        .then(() => broadcast(room))
        .catch(() => sendView(peer));
    });
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
    await Promise.allSettled([...peers].map(sendView));
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
        "DELETE FROM login_tokens WHERE expires_at<now()-interval '1 day'",
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
server.listen(config.port, "0.0.0.0", () =>
  console.info(`古楓桌遊 GFBG 服務啟動：http://localhost:${config.port}`),
);
