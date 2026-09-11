import type pg from "pg";
import { pool, transaction } from "./db.js";
import { requireCondition } from "./errors.js";
import type { Identity } from "./auth.js";
import { publicAvatarUrl } from "./avatars.js";
import type { ChatChannel, ChatMessage } from "../shared/chat.js";

interface ChatRow {
  id: string;
  channel: ChatChannel;
  room_id: string | null;
  sender_player_id: string;
  sender_name: string;
  body: string;
  created_at: Date | string;
  avatar_key: string | null;
}

function toMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    channel: row.channel,
    roomId: row.room_id,
    sender: {
      playerId: row.sender_player_id,
      name: row.sender_name,
      avatarUrl: publicAvatarUrl(row.avatar_key),
    },
    text: row.body,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

async function recent(
  db: Pick<pg.PoolClient, "query">,
  channel: ChatChannel,
  roomId: string | null,
) {
  const result = await db.query<ChatRow>(
    `SELECT recent.*,u.avatar_key
     FROM (
       SELECT id,channel,room_id,sender_user_id,sender_player_id,sender_name,body,created_at
       FROM chat_messages
       WHERE channel=$1 AND room_id IS NOT DISTINCT FROM $2::uuid
         AND created_at>=now()-interval '30 days'
       ORDER BY created_at DESC,id DESC
       LIMIT 100
     ) recent
     JOIN users u ON u.id=recent.sender_user_id
     ORDER BY recent.created_at,recent.id`,
    [channel, roomId],
  );
  return result.rows.map(toMessage);
}

async function playerRoom(
  db: Pick<pg.PoolClient, "query">,
  roomId: string,
  playerId: string,
  lock = false,
) {
  const result = await db.query<{ id: string; status: string }>(
    `SELECT r.id,r.status
     FROM rooms r JOIN members m ON m.room_id=r.id
     WHERE r.id=$1 AND m.player_id=$2${lock ? " FOR UPDATE OF r" : ""}`,
    [roomId, playerId],
  );
  requireCondition(result.rows[0], 403, "你不在這個房間。");
  return result.rows[0];
}

async function spectatorRoom(
  db: Pick<pg.PoolClient, "query">,
  code: string,
  lock = false,
) {
  const result = await db.query<{ id: string; status: string }>(
    `SELECT id,status FROM rooms WHERE code=$1${lock ? " FOR UPDATE" : ""}`,
    [code],
  );
  requireCondition(result.rows[0], 404, "找不到這個房間，請確認代碼。");
  requireCondition(result.rows[0].status !== "aborted", 410, "這個房間已經終止。");
  return result.rows[0];
}

export const publicChat = () => recent(pool, "public", null);

export async function playerRoomChat(roomId: string, who: Identity) {
  await playerRoom(pool, roomId, who.player_id);
  return recent(pool, "room", roomId);
}

export async function spectatorRoomChat(code: string) {
  const room = await spectatorRoom(pool, code);
  return { roomId: room.id, messages: await recent(pool, "room", room.id) };
}

async function createMessage(
  id: string,
  channel: ChatChannel,
  text: string,
  who: Identity,
  resolveRoomId: (db: pg.PoolClient) => Promise<string | null>,
) {
  requireCondition(who.user_id, 401, "登入會員才能發送訊息。");
  return transaction(async (db) => {
    const roomId = await resolveRoomId(db);
    const inserted = await db.query<ChatRow>(
      `INSERT INTO chat_messages(
         id,channel,room_id,sender_user_id,sender_player_id,sender_name,body
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO NOTHING
       RETURNING id,channel,room_id,sender_player_id,sender_name,body,created_at,
         $8::text AS avatar_key`,
      [
        id,
        channel,
        roomId,
        who.user_id,
        who.player_id,
        who.name,
        text,
        who.avatar_key,
      ],
    );
    if (inserted.rows[0])
      return { message: toMessage(inserted.rows[0]), isNew: true };

    const existing = await db.query<
      ChatRow & { sender_user_id: string }
    >(
      `SELECT c.*,u.avatar_key
       FROM chat_messages c JOIN users u ON u.id=c.sender_user_id
       WHERE c.id=$1`,
      [id],
    );
    const row = existing.rows[0];
    requireCondition(
      row &&
        row.sender_user_id === who.user_id &&
        row.sender_player_id === who.player_id &&
        row.channel === channel &&
        row.room_id === roomId &&
        row.body === text,
      409,
      "訊息識別碼已被使用，請重新發送。",
    );
    return { message: toMessage(row), isNew: false };
  });
}

export const sendPublicChat = (
  id: string,
  text: string,
  who: Identity,
) => createMessage(id, "public", text, who, async () => null);

export const sendPlayerRoomChat = (
  roomId: string,
  id: string,
  text: string,
  who: Identity,
) =>
  createMessage(id, "room", text, who, async (db) => {
    const room = await playerRoom(db, roomId, who.player_id, true);
    requireCondition(room.status !== "aborted", 410, "這個房間已經終止。");
    return room.id;
  });

export async function sendSpectatorRoomChat(
  code: string,
  id: string,
  text: string,
  who: Identity,
) {
  return createMessage(id, "room", text, who, async (db) => {
    const room = await spectatorRoom(db, code, true);
    return room.id;
  });
}
