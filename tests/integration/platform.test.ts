import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { SMTPServer } from "smtp-server";
import { WebSocket } from "ws";
import sharp from "sharp";
import type { RoomView, RoomAction } from "../../shared/room.js";
import type { LLView } from "../../shared/love-letter.js";
import type { SHView } from "../../shared/shadow-hunters.js";
import type { SRView } from "../../shared/shadow-raiders.js";

let db: EmbeddedPostgres;
let sql: pg.Pool;
let server: ChildProcess;
let url: string;
let env: NodeJS.ProcessEnv;
let smtp: SMTPServer;
let objectServer: HttpServer;
let objectUrl: string;
const objects = new Map<string, { body: Buffer; contentType: string; cacheControl: string }>();
let failObjectWrites = false;
const emails: string[] = [];
let failMail = false;
let serverLog = "";
const legacyUserId = randomUUID();
const legacyPlayerId = randomUUID();
const legacyEmail = "legacy@example.test";
const legacySession = randomBytes(32).toString("base64url");
async function port() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = (s.address() as any).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p as number;
}
async function startApp() {
  serverLog = "";
  server = spawn(process.execPath, ["dist/server/index.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout!.on("data", (d) => (serverLog += d));
  server.stderr!.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`App failed: ${serverLog}`);
}
async function stopApp() {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
before(
  async () => {
    await mkdir(".local", { recursive: true });
    const pgPort = await port();
    const httpPort = await port();
    const smtpPort = await port();
    const objectPort = await port();
    const password = randomBytes(24).toString("hex");
    db = new EmbeddedPostgres({
      databaseDir: resolve(".local", `test-pg-${randomUUID()}`),
      user: "postgres",
      password,
      port: pgPort,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await db.initialise();
    await db.start();
    await db.createDatabase("tablefolk_test");
    const database = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/tablefolk_test`;
    sql = new pg.Pool({ connectionString: database });
    sql.on("error", () => {});
    await sql.query(
      "CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of ["001_initial.sql", "002_reusable_rooms.sql", "003_user_avatars.sql"]) {
      await sql.query(await readFile(resolve("migrations", name), "utf8"));
      await sql.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
    await sql.query("INSERT INTO users(id,email) VALUES($1,$2)", [legacyUserId, legacyEmail]);
    await sql.query("INSERT INTO players(id,name,user_id) VALUES($1,'舊會員',$2)", [legacyPlayerId, legacyUserId]);
    await sql.query(
      "INSERT INTO sessions(token_hash,player_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
      [createHash("sha256").update(legacySession).digest("hex"), legacyPlayerId, randomBytes(32).toString("base64url")],
    );
    smtp = new SMTPServer({
      disabledCommands: ["AUTH", "STARTTLS"],
      authOptional: true,
      onData(stream, _session, callback) {
        let text = "";
        stream.on("data", (d) => (text += d));
        stream.on("end", () => {
          if (failMail) return callback(new Error("test delivery failure"));
          emails.push(text);
          callback();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(smtpPort, "127.0.0.1", r));
    objectUrl = `http://127.0.0.1:${objectPort}`;
    objectServer = createHttpServer((req, res) => {
      const path = new URL(req.url || "/", objectUrl).pathname;
      if (req.method === "HEAD" && ["/gfbg-avatars", "/gfbg-avatars/"].includes(path)) {
        res.writeHead(200).end();
        return;
      }
      if (req.method === "PUT" && path.startsWith("/gfbg-avatars/avatars/")) {
        if (failObjectWrites) {
          res.writeHead(503, { "Content-Type": "application/xml" });
          res.end("<Error><Code>ServiceUnavailable</Code></Error>");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          objects.set(path, {
            body: Buffer.concat(chunks),
            contentType: String(req.headers["content-type"] || ""),
            cacheControl: String(req.headers["cache-control"] || ""),
          });
          res.writeHead(200, { ETag: '"test-etag"' }).end();
        });
        return;
      }
      if (req.method === "DELETE" && path.startsWith("/gfbg-avatars/avatars/")) {
        objects.delete(path);
        res.writeHead(204).end();
        return;
      }
      if (req.method === "GET" && objects.has(path)) {
        const object = objects.get(path)!;
        res.writeHead(200, {
          "Content-Type": object.contentType,
          "Cache-Control": object.cacheControl,
        });
        res.end(object.body);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => objectServer.listen(objectPort, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${httpPort}`;
    env = {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(httpPort),
      PUBLIC_URL: url,
      DATABASE_URL: database,
      AUTO_MIGRATE: "true",
      TRUST_PROXY_HOPS: "0",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      SMTP_SECURE: "false",
      SMTP_FROM: "tablefolk@example.test",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      AVATAR_S3_ENDPOINT: objectUrl,
      AVATAR_S3_REGION: "us-east-1",
      AVATAR_S3_BUCKET: "gfbg-avatars",
      AVATAR_S3_ACCESS_KEY_ID: "TESTACCESSKEY",
      AVATAR_S3_SECRET_ACCESS_KEY: "test-secret-access-key",
      AVATAR_PUBLIC_BASE_URL: `${objectUrl}/gfbg-avatars`,
    };
    await startApp();
  },
  { timeout: 60000 },
);
after(async () => {
  await stopApp();
  if (smtp) await new Promise<void>((r) => smtp.close(r));
  if (objectServer) await new Promise<void>((r) => objectServer.close(() => r()));
  if (sql) await sql.end();
  if (db) await db.stop();
});
class Browser {
  cookie = "";
  me: any;
  async request(
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch(url + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: this.cookie,
        ...(body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              Origin: url,
              "X-CSRF-Token": this.me?.csrf || "",
            }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const data = await r.json();
    return { status: r.status, data };
  }
  async ok(path: string, body?: unknown) {
    const r = await this.request(path, body);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.data)}`);
    return r.data;
  }
  async raw(
    path: string,
    method: "POST" | "DELETE",
    body?: Buffer,
    contentType?: string,
  ) {
    const response = await fetch(url + "/api" + path, {
      method,
      headers: {
        Cookie: this.cookie,
        Origin: url,
        "X-CSRF-Token": this.me?.csrf || "",
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: body ? new Uint8Array(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  async boot(name = "旅人") {
    this.me = await this.ok("/me");
    await this.ok("/profile", { name });
    this.me = await this.ok("/me");
    return this;
  }
  async view<T = LLView>(id: string): Promise<RoomView<T>> {
    return this.ok(`/rooms/${id}`);
  }
  async command(id: string, action: RoomAction) {
    const r = await this.view(id);
    return this.ok(`/rooms/${id}/actions`, {
      operationId: randomUUID(),
      version: r.version,
      action,
    });
  }
}
async function wsFrame(ws: WebSocket) {
  const frame = await Promise.race([
    once(ws, "message"),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("websocket timeout")), 5000).unref(),
    ),
  ]);
  return JSON.parse(String(frame[0]));
}
async function table(n: number, gameId = "love-letter") {
  const players: Browser[] = [];
  for (let i = 0; i < n; i++)
    players.push(await new Browser().boot(`玩家${i}`));
  const { id } = await players[0].ok("/rooms", { gameId });
  const room = await players[0].view(id);
  for (const p of players.slice(1)) {
    await p.ok("/rooms/join", { code: room.code });
    p.me = await p.ok("/me");
  }
  return { id, players };
}
async function start(t: Awaited<ReturnType<typeof table>>) {
  for (const p of t.players)
    await p.command(t.id, { type: "ready", ready: true });
  await t.players[0].command(t.id, {
    type: "start",
    first: t.players[0].me.id,
  });
}
async function finishLoveLetter(t: Awaited<ReturnType<typeof table>>) {
  let turns = 0;
  while (turns++ < 1000) {
    const view = await t.players[0].view(t.id);
    if (view.status === "finished") return;
    if (view.game!.phase === "roundEnd") {
      await t.players[0].command(t.id, {
        type: "game",
        action: { type: "next" },
      });
      continue;
    }
    const actor = t.players.find((p) => p.me.id === view.game!.current)!;
    const own = await actor.view(t.id);
    const g = own.game!;
    if (g.phase === "chancellor") {
      const hand = g.players.find((p) => p.id === actor.me.id)!.hand!;
      await actor.command(t.id, {
        type: "game",
        action: {
          type: "chancellor",
          keep: hand[0].id,
          bottom: hand.slice(1).map((c) => c.id),
        },
      });
    } else {
      const legal = g.legal.cards[0];
      await actor.command(t.id, {
        type: "game",
        action: {
          type: "play",
          card: legal.id,
          ...(legal.needsTarget ? { target: legal.targets[0] } : {}),
          ...(legal.needsGuess ? { guess: 9 } : {}),
        },
      });
    }
  }
  assert.fail("Love Letter match did not finish in 1000 turns");
}
function mailText() {
  const raw = emails.at(-1)!;
  const split = raw.indexOf("\r\n\r\n");
  const headers = raw.slice(0, split);
  const body = raw.slice(split + 4);
  return /Content-Transfer-Encoding: base64/i.test(headers)
    ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")
    : body.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
}
const testPassword = "correct horse battery";
const accountLoginId = (email: string) =>
  email.split("@")[0].replace(/[^a-z0-9_]/g, "_").slice(0, 24);
async function register(
  b: Browser,
  email: string,
  loginId = accountLoginId(email),
  displayName = b.me.name,
) {
  const result = await b.ok("/auth/register", {
    loginId,
    displayName,
    email,
    password: testPassword,
  });
  b.me = await b.ok("/me");
  const token = result.verificationSent
    ? mailText().match(/#token=([A-Za-z0-9_-]{43})/)?.[1]
    : undefined;
  return { token, loginId };
}
async function login(
  b: Browser,
  loginId: string,
  password = testPassword,
) {
  await b.ok("/auth/login", { loginId, password });
  b.me = await b.ok("/me");
}

test("Migrations are repeatable; HTTP shell, CSRF and anonymous history permissions", async () => {
  assert.equal(
    (await sql.query("SELECT count(*) FROM schema_migrations")).rows[0].count,
    "5",
  );
  await stopApp();
  await startApp();
  assert.equal(
    (await sql.query("SELECT count(*) FROM schema_migrations")).rows[0].count,
    "5",
  );
  const legacy = (
    await sql.query("SELECT legacy,email,login_id FROM users WHERE id=$1", [legacyUserId])
  ).rows[0];
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.email, legacyEmail);
  assert.equal(legacy.login_id, null);
  assert.equal(
    (await sql.query("SELECT count(*) FROM sessions WHERE player_id=$1", [legacyPlayerId])).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await fetch(url + "/api/history", {
        headers: { Cookie: `bgs_session=${legacySession}` },
      })
    ).status,
    401,
  );
  const replacement = await new Browser().boot("新會員");
  await register(replacement, legacyEmail, "legacy_reborn", "新會員");
  assert.notEqual(
    (await sql.query("SELECT id FROM users WHERE login_id='legacy_reborn'")).rows[0].id,
    legacyUserId,
  );
  const shell = await fetch(url);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /zh-Hant/);
  assert.match(
    shell.headers.get("content-security-policy")!,
    /frame-ancestors 'none'/,
  );
  const b = await new Browser().boot();
  assert.equal((await b.request("/history")).status, 401);
  assert.equal(
    (
      await b.request(
        "/profile",
        { name: "bad" },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await b.request("/profile", { name: "bad" }, { "X-CSRF-Token": "bad" }))
      .status,
    403,
  );
});
test("Member avatars use RustFS-compatible storage, update rooms and safely fall back", async () => {
  await sql.query("DELETE FROM rate_limits");
  const t = await table(2);
  const member = t.players[0];
  const guest = t.players[1];
  const png = await sharp({
    create: {
      width: 480,
      height: 320,
      channels: 3,
      background: { r: 142, g: 64, b: 88 },
    },
  })
    .png()
    .toBuffer();

  assert.equal(
    (await guest.raw("/profile/avatar", "POST", png, "image/png")).status,
    401,
  );
  await register(member, "avatar@example.test");
  assert.equal(member.me.avatarEnabled, true);
  assert.equal(member.me.avatarUrl, null);

  const ws = new WebSocket(url.replace("http:", "ws:") + `/ws?room=${t.id}`, {
    headers: { Cookie: guest.cookie, Origin: url },
  });
  await once(ws, "message");
  const updated = once(ws, "message");
  const upload = await member.raw("/profile/avatar", "POST", png, "image/png");
  assert.equal(upload.status, 200, JSON.stringify(upload.data));
  assert.match(
    upload.data.avatarUrl,
    new RegExp(`^${objectUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/gfbg-avatars/avatars/[0-9a-f-]+\\.webp$`),
  );
  const message = JSON.parse(String((await updated)[0]));
  assert.equal(
    message.room.members.find((item: any) => item.id === member.me.id).avatarUrl,
    upload.data.avatarUrl,
  );
  ws.close();

  member.me = await member.ok("/me");
  assert.equal(member.me.avatarUrl, upload.data.avatarUrl);
  assert.equal((await member.view(t.id)).members[0].avatarUrl, upload.data.avatarUrl);
  const objectPath = new URL(upload.data.avatarUrl).pathname;
  const stored = objects.get(objectPath)!;
  assert.ok(stored);
  assert.equal(stored.contentType, "image/webp");
  assert.equal(stored.cacheControl, "public, max-age=31536000, immutable");
  const metadata = await sharp(stored.body).metadata();
  assert.deepEqual(
    { format: metadata.format, width: metadata.width, height: metadata.height, pages: metadata.pages || 1 },
    { format: "webp", width: 256, height: 256, pages: 1 },
  );

  const corrupt = await member.raw(
    "/profile/avatar",
    "POST",
    Buffer.from("not an image"),
    "image/png",
  );
  assert.equal(corrupt.status, 400);
  assert.equal((await member.ok("/me")).avatarUrl, upload.data.avatarUrl);
  assert.equal(
    (await member.raw("/profile/avatar", "POST", Buffer.alloc(5 * 1024 * 1024 + 1), "image/png")).status,
    413,
  );

  failObjectWrites = true;
  try {
    assert.equal(
      (await member.raw("/profile/avatar", "POST", png, "image/png")).status,
      503,
    );
  } finally {
    failObjectWrites = false;
  }
  assert.equal((await member.ok("/me")).avatarUrl, upload.data.avatarUrl);

  const replacement = await member.raw("/profile/avatar", "POST", png, "image/png");
  assert.equal(replacement.status, 200);
  assert.notEqual(replacement.data.avatarUrl, upload.data.avatarUrl);
  assert.equal(objects.has(objectPath), false);

  await sql.query("DELETE FROM rate_limits");
  const otherBrowser = await new Browser().boot("另一台");
  await login(otherBrowser, "avatar");
  assert.equal(otherBrowser.me.avatarUrl, replacement.data.avatarUrl);

  const replacementPath = new URL(replacement.data.avatarUrl).pathname;
  assert.equal((await member.raw("/profile/avatar", "DELETE")).status, 200);
  assert.equal((await member.ok("/me")).avatarUrl, null);
  assert.equal(objects.has(replacementPath), false);
});
test("Public rooms are discoverable in real time and private rooms remain watchable by code", async () => {
  const host = await new Browser().boot("公開房主");
  const watcher = await new Browser().boot("旁觀者");
  const anonymous = new Browser();
  anonymous.me = await anonymous.ok("/me");
  const { id } = await host.ok("/rooms", {
    gameId: "love-letter",
    isPublic: true,
  });
  const created = await host.view(id);
  assert.equal(created.isPublic, true);
  assert.equal(created.viewerRole, "player");
  const listed = await watcher.ok("/rooms/public");
  assert.ok(listed.rooms.some((room: any) => room.id === id));
  assert.equal(
    (await anonymous.request(`/rooms/watch/${created.code}`)).status,
    403,
  );

  const lobby = new WebSocket(url.replace("http:", "ws:") + "/ws?lobby=1", {
    headers: { Cookie: watcher.cookie, Origin: url },
  });
  lobby.on("error", () => {});
  assert.ok((await wsFrame(lobby)).rooms.some((room: any) => room.id === id));

  const spectator = new WebSocket(
    url.replace("http:", "ws:") +
      `/ws?mode=spectator&code=${created.code}`,
    { headers: { Cookie: watcher.cookie, Origin: url } },
  );
  spectator.on("error", () => {});
  const spectatorFrame = await wsFrame(spectator);
  assert.equal(spectatorFrame.room.viewerRole, "spectator");
  assert.ok(spectatorFrame.room.spectators.some((item: any) => item.name === "旁觀者"));

  const duplicate = new WebSocket(
    url.replace("http:", "ws:") +
      `/ws?mode=spectator&code=${created.code}`,
    { headers: { Cookie: watcher.cookie, Origin: url } },
  );
  duplicate.on("error", () => {});
  await wsFrame(duplicate);
  assert.equal((await host.view(id)).spectators.length, 1);

  const lobbyUpdate = (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const frame = await wsFrame(lobby);
      if (!frame.rooms.some((room: any) => room.id === id)) return frame;
    }
    throw new Error("public room did not disappear from lobby");
  })();
  await host.command(id, { type: "setVisibility", isPublic: false });
  await lobbyUpdate;
  assert.equal((await watcher.ok(`/rooms/watch/${created.code}`)).isPublic, false);

  const spectatorClosed = once(spectator, "close");
  const duplicateClosed = once(duplicate, "close");
  spectator.close();
  duplicate.close();
  await Promise.all([spectatorClosed, duplicateClosed]);
  await watcher.ok("/rooms/join", { code: created.code });
  watcher.me = await watcher.ok("/me");
  assert.equal((await host.view(id)).members.length, 2);
  const latest = await watcher.view(id);
  assert.equal(
    (
      await watcher.request(`/rooms/${id}/actions`, {
        operationId: randomUUID(),
        version: latest.version,
        action: { type: "setVisibility", isPublic: true },
      })
    ).status,
    403,
  );
  lobby.close();
});

test("Spectator views for every game hide private state and never take a seat", async () => {
  await sql.query("DELETE FROM rate_limits");
  const watcher = await new Browser().boot("安全旁觀者");
  for (const [gameId, players] of [
    ["love-letter", 2],
    ["shadow-hunters", 4],
    ["shadow-raiders-airship", 4],
  ] as const) {
    const t = await table(players, gameId);
    await start(t);
    const playerRoom = await t.players[0].view(t.id);
    const before = (
      await sql.query("SELECT count(*)::int AS count FROM members WHERE room_id=$1", [
        t.id,
      ])
    ).rows[0].count;
    const view = await watcher.ok(`/rooms/watch/${playerRoom.code}`);
    assert.equal(view.viewerRole, "spectator");
    assert.equal(view.members.length, before);
    if (gameId === "love-letter") {
      assert.ok(view.game.players.every((player: any) => player.hand === undefined));
      assert.deepEqual(view.game.legal, { cards: [], chancellor: false });
    } else {
      assert.ok(view.game.players.every((player: any) => player.character === undefined));
      assert.equal(view.game.legal.pending, undefined);
      assert.ok(Object.values(view.game.legal).every((value) => value === false));
    }
    assert.equal(
      (
        await sql.query("SELECT count(*)::int AS count FROM members WHERE room_id=$1", [
          t.id,
        ])
      ).rows[0].count,
      before,
    );
  }
  await sql.query("DELETE FROM rate_limits");
});

test("Rooms require membership; race joins cap at six; start requires ready; seats lock on start", async () => {
  const t = await table(2);
  const stranger = await new Browser().boot("外人");
  assert.equal((await stranger.request(`/rooms/${t.id}`)).status, 403);
  const initial = await t.players[0].view(t.id);
  assert.equal(
    (
      await t.players[0].request(`/rooms/${t.id}/actions`, {
        operationId: randomUUID(),
        version: initial.version,
        action: { type: "start", first: t.players[0].me.id },
      })
    ).status,
    409,
  );
  await start(t);
  assert.equal(
    (await stranger.request("/rooms/join", { code: initial.code })).status,
    409,
  );
  const r = await t.players[0].view(t.id);
  assert.ok(r.game);
  assert.equal(
    r.game.players.find((p) => p.id === stranger.me.id),
    undefined,
  );
  assert.equal(r.game.players[1].hand, undefined);
  await t.players[0].command(t.id, { type: "abort" });
  assert.equal(
    (await sql.query("SELECT 1 FROM matches WHERE room_id=$1", [t.id])).rowCount,
    0,
  );
  assert.equal(
    (await t.players[0].request(`/rooms/${t.id}/actions`, {
      operationId: randomUUID(),
      version: (await t.players[0].view(t.id)).version,
      action: { type: "returnToLobby" },
    })).status,
    409,
  );
  const seats = await table(5);
  const a = await new Browser().boot("A"),
    b = await new Browser().boot("B");
  const code = (await seats.players[0].view(seats.id)).code;
  const joins = await Promise.all([
    a.request("/rooms/join", { code }),
    b.request("/rooms/join", { code }),
  ]);
  assert.deepEqual(joins.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await seats.players[0].view(seats.id)).members.length, 6);
});
test("Row locks serialize competing commands and operation retries are idempotent, including after restart", async () => {
  const t = await table(2);
  const p = t.players[0];
  const v = await p.view(t.id);
  const body = {
    operationId: randomUUID(),
    version: v.version,
    action: { type: "ready", ready: true },
  };
  const result = await Promise.all([
    p.request(`/rooms/${t.id}/actions`, body),
    p.request(`/rooms/${t.id}/actions`, body),
  ]);
  assert.ok(result.every((r) => r.status === 200));
  assert.equal((await p.view(t.id)).version, v.version + 1);
  const stale = await p.request(`/rooms/${t.id}/actions`, {
    ...body,
    operationId: randomUUID(),
  });
  assert.equal(stale.status, 409);
  const before = await p.view(t.id);
  await stopApp();
  await startApp();
  const again = await p.ok(`/rooms/${t.id}/actions`, body);
  assert.equal(again.duplicate, true);
  assert.deepEqual(await p.view(t.id), before);
  const tokenHash = createHash("sha256")
    .update(p.cookie.split("=")[1])
    .digest("hex");
  const row = await sql.query("SELECT 1 FROM sessions WHERE token_hash=$1", [
    tokenHash,
  ]);
  assert.equal(row.rowCount, 1);
  const latest = await p.view(t.id);
  const competing = await Promise.all(
    [true, false].map((ready) =>
      p.request(`/rooms/${t.id}/actions`, {
        operationId: randomUUID(),
        version: latest.version,
        action: { type: "ready", ready },
      }),
    ),
  );
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
});
test("Active game snapshot and operation survive restart with no duplicate draw or score", async () => {
  const t = await table(2);
  await start(t);
  const p = t.players[0];
  const initial = await p.view(t.id);
  const legal = initial.game!.legal.cards[0];
  const command = {
    operationId: randomUUID(),
    version: initial.version,
    action: {
      type: "game",
      action: {
        type: "play",
        card: legal.id,
        ...(legal.needsTarget ? { target: legal.targets[0] } : {}),
        ...(legal.needsGuess ? { guess: 9 } : {}),
      },
    },
  };
  await p.ok(`/rooms/${t.id}/actions`, command);
  const before = await p.view(t.id);
  await stopApp();
  await startApp();
  assert.deepEqual(await p.view(t.id), before);
  assert.equal((await p.ok(`/rooms/${t.id}/actions`, command)).duplicate, true);
  assert.deepEqual(await p.view(t.id), before);
});
test(
  "Shadow Hunters opens a private 4-player table, survives restart and records one complete result",
  { timeout: 120000 },
  async () => {
    const t = await table(4, "shadow-hunters");
    await start(t);
    const initial = await t.players[0].view<SHView>(t.id);
    assert.equal(initial.gameId, "shadow-hunters");
    assert.ok(initial.game!.players[0].character);
    assert.equal(initial.game!.players[1].character, undefined);
    assert.ok(t.players.some((p) => p.me.id === initial.game!.current));
    await stopApp();
    await startApp();
    assert.deepEqual(await t.players[0].view<SHView>(t.id), initial);

    let actions = 0;
    while (actions++ < 2500) {
      const publicView = await t.players[0].view<SHView>(t.id);
      if (publicView.status === "finished") break;
      let actor: Browser | undefined;
      let own: RoomView<SHView> | undefined;
      for (const browser of t.players) {
        const candidate = await browser.view<SHView>(t.id);
        if (candidate.game!.legal.pending) {
          actor = browser;
          own = candidate;
          break;
        }
      }
      assert.ok(actor && own, "a player must own the pending decision");
      const pending = own.game!.legal.pending!;
      if (pending.options.some((o) => o.id === "roll")) {
        await actor.command(t.id, { type: "game", action: { type: "roll", promptId: pending.id } });
        continue;
      }
      let option = pending.options[0];
      if (pending.kind === "area") option = pending.options.find((o) => o.id === "skip")!;
      if (pending.kind === "attack") option = pending.options.find((o) => o.id !== "skip") || pending.options[0];
      if (pending.kind === "turn-end") option = pending.options.find((o) => o.id === "end")!;
      if (["counter", "charles"].includes(pending.kind)) option = pending.options.at(-1)!;
      await actor.command(t.id, { type: "game", action: { type: "choose", promptId: pending.id, optionId: option.id } });
    }
    const finished = await t.players[0].view<SHView>(t.id);
    assert.equal(finished.status, "finished", `did not finish in ${actions} actions`);
    assert.ok(finished.game!.players.every((p) => p.character));
    assert.equal((await sql.query("SELECT count(*) FROM matches WHERE room_id=$1", [t.id])).rows[0].count, "1");
    assert.equal((await sql.query("SELECT count(*) FROM results r JOIN matches m ON m.id=r.match_id WHERE m.room_id=$1", [t.id])).rows[0].count, "4");
    assert.ok((await sql.query("SELECT r.score FROM results r JOIN matches m ON m.id=r.match_id WHERE m.room_id=$1", [t.id])).rows.every((r) => r.score === 0 || r.score === 1));
  },
);
test(
  "Shadow Raiders Airship completes a private 10-player HTTP/WebSocket game and records one result",
  { timeout: 180000 },
  async () => {
    const t = await table(10, "shadow-raiders-airship");
    await start(t);
    const initial = await t.players[0].view<SRView>(t.id);
    assert.equal(initial.gameId, "shadow-raiders-airship");
    assert.equal(initial.members.length, 10);
    assert.ok(initial.game!.players[0].character);
    assert.equal(initial.game!.players[1].character, undefined);
    const ws = new WebSocket(url.replace("http:", "ws:") + `/ws?room=${t.id}`, { headers: { Cookie: t.players[0].cookie, Origin: url } });
    const frame = await Promise.race([once(ws, "message"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Airship websocket timeout")), 5000).unref())]);
    const message = JSON.parse(String(frame[0]));
    assert.equal(message.room.game.players[1].character, undefined);
    ws.close();
    await stopApp();
    await startApp();
    assert.deepEqual(await t.players[0].view<SRView>(t.id), initial);

    let actions = 0;
    while (actions++ < 5000) {
      const publicView = await t.players[0].view<SRView>(t.id);
      if (publicView.status === "finished") break;
      let actor: Browser | undefined;
      let own: RoomView<SRView> | undefined;
      for (const browser of t.players) {
        const candidate = await browser.view<SRView>(t.id);
        if (candidate.game!.legal.pending) { actor = browser; own = candidate; break; }
      }
      assert.ok(actor && own, "a player must own the pending Airship decision");
      const pending = own.game!.legal.pending!;
      if (pending.options.some((o) => o.id === "roll")) {
        await actor.command(t.id, { type: "game", action: { type: "roll", promptId: pending.id } });
        continue;
      }
      let option = pending.options[0];
      if (pending.kind === "area") option = pending.options.find((o) => o.id === "use")!;
      if (pending.kind === "attack") option = pending.options.find((o) => !["skip", "parasol"].includes(o.id)) || pending.options.at(-1)!;
      if (["turn-end", "counter", "craig"].includes(pending.kind)) option = pending.options.at(-1)!;
      if (["urlich", "reasoning-payment", "venom"].includes(pending.kind)) option = pending.options[0];
      await actor.command(t.id, { type: "game", action: { type: "choose", promptId: pending.id, optionId: option.id } });
    }
    const finished = await t.players[0].view<SRView>(t.id);
    assert.equal(finished.status, "finished", `Airship did not finish in ${actions} actions`);
    assert.ok(finished.game!.players.every((p) => p.character));
    assert.equal((await sql.query("SELECT count(*) FROM matches WHERE room_id=$1", [t.id])).rows[0].count, "1");
    assert.equal((await sql.query("SELECT count(*) FROM results r JOIN matches m ON m.id=r.match_id WHERE m.room_id=$1", [t.id])).rows[0].count, "10");
    assert.ok((await sql.query("SELECT r.score FROM results r JOIN matches m ON m.id=r.match_id WHERE m.room_id=$1", [t.id])).rows.every((r) => r.score === 0 || r.score === 1));
  },
);
test("Registration rotates the session; Email verification is cross-browser, single-use and never logs in", async () => {
  await sql.query("DELETE FROM rate_limits");
  const t = await table(2);
  const p = t.players[0];
  const oldCookie = p.cookie;
  const { token } = await register(
    p,
    "alice@example.test",
    "Alice_One",
    "愛麗絲",
  );
  assert.ok(token);
  assert.notEqual(p.cookie, oldCookie);
  assert.equal(p.me.isMember, true);
  assert.equal(p.me.loginId, "alice_one");
  assert.equal(p.me.name, "愛麗絲");
  assert.equal(p.me.email, "alice@example.test");
  assert.equal(p.me.emailVerified, false);
  assert.equal((await p.view(t.id)).members[0].id, p.me.id);
  assert.equal(
    (await fetch(url + "/api/me", { headers: { Cookie: oldCookie } })).status,
    200,
  ); // an expired cookie gets a new guest, never the former identity
  const stale = await fetch(url + "/api/history", {
    headers: { Cookie: oldCookie },
  });
  assert.equal(stale.status, 401);

  const verifier = await new Browser().boot("Verifier");
  const resent = await p.ok("/auth/resend-verification", {});
  assert.equal(resent.verificationSent, true);
  const replacementToken = mailText().match(/#token=([A-Za-z0-9_-]{43})/)![1];
  assert.equal((await verifier.request("/auth/verify-email", { token })).status, 400);
  await verifier.ok("/auth/verify-email", { token: replacementToken });
  verifier.me = await verifier.ok("/me");
  assert.equal(verifier.me.isMember, false);
  p.me = await p.ok("/me");
  assert.equal(p.me.emailVerified, true);
  assert.equal(
    (await p.request("/auth/verify-email", { token: replacementToken })).status,
    400,
  );

  const expiring = await new Browser().boot("Expiring");
  const { token: exp } = await register(
    expiring,
    "expired@example.test",
    "expired_user",
    "到期測試",
  );
  assert.ok(exp);
  const tokenHash = createHash("sha256").update(exp).digest("hex");
  await fetch(url + "/auth/verify-email");
  assert.equal(
    (
      await sql.query(
        "SELECT consumed_at FROM account_tokens WHERE token_hash=$1",
        [tokenHash],
      )
    ).rows[0].consumed_at,
    null,
  );
  await sql.query(
    "UPDATE account_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash],
  );
  assert.equal(
    (await verifier.request("/auth/verify-email", { token: exp })).status,
    400,
  );
});
test("SMTP failure leaves a new account active and allows verification to be resent", async () => {
  await sql.query("DELETE FROM rate_limits");
  const b = await new Browser().boot("Mail");
  failMail = true;
  const r = await b.request("/auth/register", {
    loginId: "mail_failure",
    displayName: "Mail",
    email: "failure@example.test",
    password: testPassword,
  });
  failMail = false;
  assert.equal(r.status, 200);
  assert.equal(r.data.verificationSent, false);
  b.me = await b.ok("/me");
  assert.equal(b.me.isMember, true);
  assert.equal(b.me.emailVerified, false);
  assert.equal(
    (
      await sql.query(
        "SELECT count(*) FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE u.email='failure@example.test'",
      )
    ).rows[0].count,
    "0",
  );
  const resent = await b.ok("/auth/resend-verification", {});
  assert.equal(resent.verificationSent, true);
  const beforeForgot = emails.length;
  const requester = await new Browser().boot("Reset requester");
  await requester.ok("/auth/forgot-password", { email: "failure@example.test" });
  assert.equal(emails.length, beforeForgot);
  assert.equal(
    (await b.request("/rooms", { gameId: "love-letter" })).status,
    200,
  );
});
test("An account can reclaim a seat on another browser but cannot occupy two seats in the same active room", async () => {
  await sql.query("DELETE FROM rate_limits");
  const t = await table(2);
  const p = t.players[0];
  await register(p, "reclaim@example.test", "reclaim", "原名");
  await p.ok("/profile", { name: "開局名" });
  p.me = await p.ok("/me");
  assert.equal(p.me.name, "開局名");
  assert.equal((await p.view(t.id)).members[0].name, "開局名");
  await start(t);
  await p.ok("/profile", { name: "下局名" });
  const active = await p.view<LLView>(t.id);
  assert.equal(active.members[0].name, "下局名");
  assert.equal(active.game!.players[0].name, "開局名");
  assert.equal(
    (await sql.query("SELECT name FROM players WHERE id=$1", [p.me.id])).rows[0].name,
    "開局名",
  );
  const code = (await p.view(t.id)).code;
  await sql.query("DELETE FROM rate_limits");
  const second = await new Browser().boot("另一台");
  await login(second, "reclaim");
  await second.ok("/rooms/join", { code });
  second.me = await second.ok("/me");
  assert.equal(second.me.id, p.me.id);
  assert.equal((await second.view(t.id)).members.length, 2);
  const other = t.players[1];
  await sql.query("DELETE FROM rate_limits");
  assert.equal(
    (
      await other.request("/auth/login", {
        loginId: "reclaim",
        password: testPassword,
      })
    ).status,
    409,
  );
});

test("Verified Email resets passwords, revokes sessions, and password changes rotate the current session", async () => {
  await sql.query("DELETE FROM rate_limits");
  const owner = await new Browser().boot("Owner");
  const { token } = await register(
    owner,
    "recovery@example.test",
    "recovery_user",
    "可復原會員",
  );
  assert.ok(token);
  const verifier = await new Browser().boot("Verifier");
  await verifier.ok("/auth/verify-email", { token });

  const second = await new Browser().boot("Second");
  await login(second, "RECOVERY_USER");
  const ownerCookie = owner.cookie;
  const secondCookie = second.cookie;
  const requester = await new Browser().boot("Requester");
  await requester.ok("/auth/forgot-password", { email: "recovery@example.test" });
  const resetToken = mailText().match(/#token=([A-Za-z0-9_-]{43})/)![1];
  await requester.ok("/auth/reset-password", {
    token: resetToken,
    newPassword: "new recovery password",
  });
  for (const cookie of [ownerCookie, secondCookie]) {
    assert.equal(
      (await fetch(url + "/api/history", { headers: { Cookie: cookie } })).status,
      401,
    );
  }
  const oldAttempt = await new Browser().boot("Old password");
  const wrongPassword = await oldAttempt.request("/auth/login", {
        loginId: "recovery_user",
        password: testPassword,
      });
  assert.equal(wrongPassword.status, 401);
  const missingAccount = await oldAttempt.request("/auth/login", {
    loginId: "missing_user",
    password: testPassword,
  });
  assert.equal(missingAccount.status, 401);
  assert.equal(missingAccount.data.error, wrongPassword.data.error);
  const current = await new Browser().boot("New password");
  await login(current, "recovery_user", "new recovery password");
  const otherSession = await new Browser().boot("Other current session");
  await login(otherSession, "recovery_user", "new recovery password");
  const otherSessionCookie = otherSession.cookie;
  const beforeChange = current.cookie;
  assert.equal(
    (
      await current.request("/auth/change-password", {
        currentPassword: "wrong password",
        newPassword: "final recovery password",
      })
    ).status,
    401,
  );
  await current.ok("/auth/change-password", {
    currentPassword: "new recovery password",
    newPassword: "final recovery password",
  });
  assert.notEqual(current.cookie, beforeChange);
  assert.equal(
    (
      await fetch(url + "/api/history", {
        headers: { Cookie: otherSessionCookie },
      })
    ).status,
    401,
  );
  current.me = await current.ok("/me");
  assert.equal(current.me.loginId, "recovery_user");
});
test("WebSocket delivers only personal view and verifies origin/membership; rejoining works", async () => {
  const t = await table(2);
  await start(t);
  const p = t.players[0];
  const ws = new WebSocket(url.replace("http:", "ws:") + `/ws?room=${t.id}`, {
    headers: { Cookie: p.cookie, Origin: url },
  });
  const frame = await Promise.race([
    once(ws, "message"),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("websocket timeout")), 5000).unref(),
    ),
  ]);
  const message = JSON.parse(String(frame[0]));
  assert.equal(message.type, "room");
  assert.equal(message.room.game.players[1].hand, undefined);
  ws.close();
  const bad = new WebSocket(url.replace("http:", "ws:") + `/ws?room=${t.id}`, {
    headers: { Cookie: p.cookie, Origin: "https://evil.test" },
  });
  bad.on("error", () => {});
  const rejection = await once(bad, "unexpected-response");
  assert.equal((rejection[1] as any).statusCode, 403);
  bad.terminate();
  const code = (await p.view(t.id)).code;
  await p.ok("/rooms/join", { code });
  assert.equal((await p.view(t.id)).members.length, 2);
});
test("A finished room transfers an offline host to an online member", async () => {
  await sql.query("DELETE FROM rate_limits");
  const t = await table(2);
  await start(t);
  await finishLoveLetter(t);
  assert.equal((await t.players[0].view(t.id)).status, "finished");
  const p = t.players[1];
  await sql.query(
    "UPDATE members SET last_seen=now()-interval '65 seconds' WHERE room_id=$1 AND player_id=$2",
    [t.id, t.players[0].me.id],
  );
  await sql.query(
    "UPDATE members SET last_seen=now() WHERE room_id=$1 AND player_id=$2",
    [t.id, p.me.id],
  );
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.PUBLIC_URL = url;
  const { transferHosts } = await import("../../server/rooms.js");
  const changed = await transferHosts();
  assert.ok(changed.includes(t.id));
  assert.equal((await p.view(t.id)).hostId, p.me.id);
  const { pool } = await import("../../server/db.js");
  await pool.end();
});
test(
  "2/4/6-player end-to-end matches record once, support login before finish, and protect history",
  { timeout: 120000 },
  async () => {
    for (const n of [2, 4, 6]) {
      await sql.query("DELETE FROM rate_limits");
      const t = await table(n);
      await start(t);
      await register(t.players[0], `winner${n}@example.test`);
      await finishLoveLetter(t);
      assert.equal(
        (await sql.query("SELECT count(*) FROM matches WHERE room_id=$1", [t.id]))
          .rows[0].count,
        "1",
      );
      const match = (
        await sql.query("SELECT id FROM matches WHERE room_id=$1", [t.id])
      ).rows[0];
      assert.equal(
        (
          await sql.query("SELECT count(*) FROM results WHERE match_id=$1", [
            match.id,
          ])
        ).rows[0].count,
        String(n),
      );
      const hist = await t.players[0].ok("/history");
      assert.equal(hist.matches.length, 1);
      assert.equal(hist.matches[0].match_id, match.id);
      await register(t.players[1], `late${n}@example.test`);
      assert.equal((await t.players[1].ok("/history")).matches.length, 0);
    }
  },
);
test(
  "Finished rooms return to the lobby and record multiple matches with stable seats",
  { timeout: 120000 },
  async () => {
    await sql.query("DELETE FROM rate_limits");
    const t = await table(2);
    const host = t.players[0];
    const guest = t.players[1];
    await register(host, "rematch@example.test");
    await start(t);
    await finishLoveLetter(t);

    const finished = await host.view(t.id);
    const memberIds = finished.members.map((m) => m.id);
    assert.equal(finished.status, "finished");
    assert.equal(
      (await guest.request(`/rooms/${t.id}/actions`, {
        operationId: randomUUID(),
        version: finished.version,
        action: { type: "returnToLobby" },
      })).status,
      403,
    );

    const reset = {
      operationId: randomUUID(),
      version: finished.version,
      action: { type: "returnToLobby" } as const,
    };
    await host.ok(`/rooms/${t.id}/actions`, reset);
    assert.equal((await host.ok(`/rooms/${t.id}/actions`, reset)).duplicate, true);
    const waiting = await host.view(t.id);
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.game, null);
    assert.equal(waiting.code, finished.code);
    assert.equal(waiting.gameId, finished.gameId);
    assert.equal(waiting.hostId, finished.hostId);
    assert.deepEqual(waiting.members.map((m) => m.id), memberIds);
    assert.ok(waiting.members.every((m) => !m.ready));
    assert.equal(
      (await host.request(`/rooms/${t.id}/actions`, {
        ...reset,
        operationId: randomUUID(),
      })).status,
      409,
    );

    const newcomer = await new Browser().boot("替補");
    await newcomer.ok("/rooms/join", { code: waiting.code });
    assert.equal((await host.view(t.id)).members.length, 3);
    await newcomer.command(t.id, { type: "leave" });
    assert.equal((await host.view(t.id)).members.length, 2);

    await start(t);
    assert.equal(
      (await host.request(`/rooms/${t.id}/actions`, {
        operationId: randomUUID(),
        version: (await host.view(t.id)).version,
        action: { type: "returnToLobby" },
      })).status,
      409,
    );
    await finishLoveLetter(t);

    const matches = await sql.query(
      "SELECT id FROM matches WHERE room_id=$1 ORDER BY finished_at",
      [t.id],
    );
    assert.equal(matches.rowCount, 2);
    assert.notEqual(matches.rows[0].id, matches.rows[1].id);
    assert.equal(
      (await sql.query("SELECT count(*) FROM results r JOIN matches m ON m.id=r.match_id WHERE m.room_id=$1", [t.id])).rows[0].count,
      "4",
    );
    const history = await host.ok("/history");
    assert.equal(history.matches.length, 2);
  },
);
test(
  "Database outage returns 503 without a phantom operation; connection and persisted rooms recover",
  { timeout: 30000 },
  async () => {
    await sql.query("DELETE FROM rate_limits");
    const t = await table(2);
    const before = await t.players[0].view(t.id);
    await db.stop();
    assert.equal((await fetch(url + "/api/health")).status, 503);
    const command = {
      operationId: randomUUID(),
      version: before.version,
      action: { type: "ready", ready: true },
    };
    assert.equal(
      (await t.players[0].request(`/rooms/${t.id}/actions`, command)).status,
      503,
    );
    await db.start();
    for (let i = 0; i < 50; i++) {
      try {
        await sql.query("SELECT 1");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.equal((await t.players[0].view(t.id)).version, before.version);
    await t.players[0].ok(`/rooms/${t.id}/actions`, command);
    assert.equal((await t.players[0].view(t.id)).version, before.version + 1);
  },
);

test(
  "PostgreSQL custom-format backup restores users, game state, sessions and results into a fresh database",
  {
    skip:
      !process.env.PG_BIN &&
      "Set PG_BIN to a PostgreSQL 18+ tools directory to verify pg_dump/pg_restore",
    timeout: 30000,
  },
  async () => {
    await stopApp();
    const connection = new URL(env.DATABASE_URL!);
    const toolEnv = {
      ...process.env,
      PGHOST: connection.hostname,
      PGPORT: connection.port,
      PGUSER: decodeURIComponent(connection.username),
      PGPASSWORD: decodeURIComponent(connection.password),
    };
    const ext = process.platform === "win32" ? ".exe" : "";
    const dump = resolve(".local", `backup-${randomUUID()}.dump`);
    const run = promisify(execFile);
    await run(
      resolve(process.env.PG_BIN!, `pg_dump${ext}`),
      ["-d", "tablefolk_test", "-Fc", "-f", dump],
      { env: toolEnv, windowsHide: true },
    );
    await db.createDatabase("tablefolk_restore");
    await run(
      resolve(process.env.PG_BIN!, `pg_restore${ext}`),
      [
        "-d",
        "tablefolk_restore",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        dump,
      ],
      { env: toolEnv, windowsHide: true },
    );
    const restoredUrl = new URL(connection);
    restoredUrl.pathname = "/tablefolk_restore";
    const restored = new pg.Pool({ connectionString: restoredUrl.toString() });
    try {
      for (const table of [
        "users",
        "players",
        "sessions",
        "account_tokens",
        "rooms",
        "members",
        "operations",
        "matches",
        "results",
        "schema_migrations",
      ]) {
        const query = `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`;
        assert.deepEqual(
          (await restored.query(query)).rows,
          (await sql.query(query)).rows,
          `restored ${table}`,
        );
      }
    } finally {
      await restored.end();
      await startApp();
    }
  },
);
