import { randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import { pool, transaction } from "./db.js";
import { getGame } from "./games/registry.js";
import { requireCondition } from "./errors.js";
import type { Identity } from "./auth.js";
import type {
  PublicRoomSummary,
  RoomCommand,
  RoomView,
  Spectator,
} from "../shared/room.js";
import { publicAvatarUrl } from "./avatars.js";
interface Room {
  id: string;
  code: string;
  game_id: string;
  host_id: string;
  status: RoomView["status"];
  is_public: boolean;
  version: number;
  state: any;
}
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () =>
  Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(
    "",
  );
export async function createRoom(
  who: Identity,
  gameId: string,
  isPublic = false,
) {
  getGame(gameId);
  return transaction(async (db) => {
    await db.query("SELECT id FROM players WHERE id=$1 FOR UPDATE", [
      who.player_id,
    ]);
    const existing = await db.query(
      "SELECT count(*) FROM members m JOIN rooms r ON r.id=m.room_id WHERE m.player_id=$1 AND r.status IN ('waiting','active')",
      [who.player_id],
    );
    requireCondition(
      Number(existing.rows[0].count) < 5,
      409,
      "最多同時保留 5 個房間，請先結束或離開舊房間。",
    );
    const id = randomUUID();
    await db.query(
      "INSERT INTO rooms(id,code,game_id,host_id,is_public) VALUES($1,$2,$3,$4,$5)",
      [id, code(), gameId, who.player_id, isPublic],
    );
    await db.query(
      "INSERT INTO members(room_id,player_id,position) VALUES($1,$2,0)",
      [id, who.player_id],
    );
    return id;
  });
}
export async function joinRoom(who: Identity, roomCode: string) {
  return transaction(async (db) => {
    if (who.user_id)
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        who.user_id,
      ]);
    const {
      rows: [room],
    } = await db.query<Room>("SELECT * FROM rooms WHERE code=$1 FOR UPDATE", [
      roomCode,
    ]);
    requireCondition(room, 404, "找不到這個房間，請確認代碼。");
    const members = await db.query(
      "SELECT m.player_id,p.user_id FROM members m JOIN players p ON p.id=m.player_id WHERE m.room_id=$1",
      [room.id],
    );
    const same = members.rows.find(
      (m) =>
        m.player_id === who.player_id ||
        (who.user_id && m.user_id === who.user_id),
    );
    if (same) {
      await db.query("UPDATE sessions SET player_id=$1 WHERE token_hash=$2", [
        same.player_id,
        who.token_hash,
      ]);
      return room.id;
    }
    requireCondition(
      room.status === "waiting",
      409,
      "對局已開始或結束，不能加入新座位。",
    );
    requireCondition(
      members.rows.length < getGame(room.game_id).info.maxPlayers,
      409,
      "房間已滿。",
    );
    await db.query(
      "INSERT INTO members(room_id,player_id,position) SELECT $1,$2,coalesce(max(position),-1)+1 FROM members WHERE room_id=$1",
      [room.id, who.player_id],
    );
    await db.query(
      "UPDATE rooms SET version=version+1,updated_at=now() WHERE id=$1",
      [room.id],
    );
    return room.id;
  });
}
async function viewWith(
  db: Pick<pg.PoolClient, "query">,
  id: string,
  who: string,
  viewerRole: RoomView["viewerRole"],
  spectatorIds: string[],
): Promise<RoomView> {
  const {
    rows: [room],
  } = await db.query<Room>("SELECT * FROM rooms WHERE id=$1", [id]);
  requireCondition(room, 404, "房間不存在。");
  const members = await db.query(
    "SELECT p.id,coalesce(u.display_name,p.name) AS name,m.ready,m.position,(m.last_seen>now()-interval '45 seconds') AS online,u.avatar_key FROM members m JOIN players p ON p.id=m.player_id LEFT JOIN users u ON u.id=p.user_id AND NOT u.legacy WHERE m.room_id=$1 ORDER BY m.position",
    [id],
  );
  if (viewerRole === "player")
    requireCondition(
      members.rows.some((m) => m.id === who),
      403,
      "你不在這個房間。",
    );
  else
    requireCondition(room.status !== "aborted", 410, "這個房間已經終止。");
  let spectators: Spectator[] = [];
  if (spectatorIds.length) {
    const rows = await db.query(
      "SELECT p.id,coalesce(u.display_name,p.name) AS name,u.avatar_key FROM players p LEFT JOIN users u ON u.id=p.user_id AND NOT u.legacy WHERE p.id=ANY($1::uuid[]) ORDER BY coalesce(u.display_name,p.name),p.id",
      [spectatorIds],
    );
    spectators = rows.rows.map(({ avatar_key, ...spectator }) => ({
      ...spectator,
      avatarUrl: publicAvatarUrl(avatar_key),
    }));
  }
  return {
    id,
    code: room.code,
    gameId: room.game_id,
    hostId: room.host_id,
    status: room.status,
    isPublic: room.is_public,
    viewerRole,
    version: room.version,
    members: members.rows.map(({ avatar_key, ...member }) => ({
      ...member,
      avatarUrl: publicAvatarUrl(avatar_key),
    })),
    spectators,
    game: room.state
      ? viewerRole === "player"
        ? getGame(room.game_id).playerView(room.state, who)
        : getGame(room.game_id).spectatorView(room.state)
      : null,
  };
}
export async function roomView(
  id: string,
  who: string,
  spectatorIds: string[] = [],
) {
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return viewWith(db, id, who, "player", spectatorIds);
  });
}
export async function watchRoom(
  roomCode: string,
  who: string,
  spectatorIds: string[] | ((roomId: string) => string[]) = [],
) {
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const room = await db.query<{ id: string }>(
      "SELECT id FROM rooms WHERE code=$1",
      [roomCode],
    );
    requireCondition(room.rows[0], 404, "找不到這個房間，請確認代碼。");
    const ids =
      typeof spectatorIds === "function"
        ? spectatorIds(room.rows[0].id)
        : spectatorIds;
    return viewWith(db, room.rows[0].id, who, "spectator", ids);
  });
}
export async function publicRooms(
  spectatorCounts: ReadonlyMap<string, number>,
): Promise<PublicRoomSummary[]> {
  const rooms = await pool.query(
    "SELECT r.id,r.code,r.game_id,r.status,r.updated_at,count(m.player_id)::int AS player_count FROM rooms r JOIN members m ON m.room_id=r.id WHERE r.is_public AND r.status IN ('waiting','active') GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 50",
  );
  return rooms.rows.map((room) => ({
    id: room.id,
    code: room.code,
    gameId: room.game_id,
    status: room.status,
    playerCount: room.player_count,
    spectatorCount: spectatorCounts.get(room.id) || 0,
    updatedAt:
      room.updated_at instanceof Date
        ? room.updated_at.toISOString()
        : String(room.updated_at),
  }));
}
export async function applyRoomAction(
  id: string,
  who: Identity,
  operation: string,
  version: number,
  action: RoomCommand,
) {
  return transaction(async (db) => {
    const {
      rows: [room],
    } = await db.query<Room>("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    requireCondition(room, 404, "房間不存在。");
    const members = (
      await db.query(
        "SELECT m.*,coalesce(u.display_name,p.name) AS name,p.name AS snapshot_name,p.user_id FROM members m JOIN players p ON p.id=m.player_id LEFT JOIN users u ON u.id=p.user_id AND NOT u.legacy WHERE m.room_id=$1 ORDER BY m.position",
        [id],
      )
    ).rows;
    const member = members.find((m) => m.player_id === who.player_id);
    const previous = (
      await db.query(
        "SELECT * FROM operations WHERE room_id=$1 AND operation_id=$2",
        [id, operation],
      )
    ).rows[0];
    if (previous) {
      requireCondition(
        previous.player_id === who.player_id,
        403,
        "操作識別不符。",
      );
      return { left: !member, duplicate: true };
    }
    requireCondition(member, 403, "你不在這個房間。");
    requireCondition(
      room.version === version,
      409,
      "牌桌已更新，請依最新狀態重新操作。",
    );
    const game = getGame(room.game_id);
    if (action.type === "setVisibility") {
      requireCondition(room.host_id === who.player_id, 403, "只有房主能切換公開狀態。");
      requireCondition(room.status !== "aborted", 409, "房間已經終止。");
      room.is_public = action.isPublic;
    } else if (action.type === "ready") {
      requireCondition(room.status === "waiting", 409, "對局已開始。");
      await db.query(
        "UPDATE members SET ready=$1 WHERE room_id=$2 AND player_id=$3",
        [action.ready, id, who.player_id],
      );
    } else if (action.type === "start") {
      requireCondition(room.host_id === who.player_id, 403, "只有房主能開始。");
      requireCondition(
        room.status === "waiting" &&
          members.length >= game.info.minPlayers &&
          members.every((m) => m.ready),
        409,
        "需要足夠玩家且所有人準備完成。",
      );
      const first =
        game.info.firstPlayerPolicy === "random"
          ? members[randomInt(members.length)].player_id
          : action.first;
      requireCondition(
        !!first && members.some((m) => m.player_id === first),
        400,
        "先手玩家不存在。",
      );
      for (const m of members) {
        await db.query("UPDATE players SET name=$1 WHERE id=$2", [
          m.name,
          m.player_id,
        ]);
      }
      room.state = game.initialize(
        members.map((m) => ({ id: m.player_id, name: m.name })),
        first,
        randomInt,
      );
      room.status = "active";
    } else if (action.type === "returnToLobby") {
      requireCondition(
        room.host_id === who.player_id,
        403,
        "只有房主能回到準備大廳。",
      );
      requireCondition(room.status === "finished", 409, "對局尚未結束。");
      await db.query("UPDATE members SET ready=false WHERE room_id=$1", [id]);
      room.state = null;
      room.status = "waiting";
    } else if (action.type === "abort") {
      requireCondition(
        room.host_id === who.player_id,
        403,
        "只有房主能終止對局。",
      );
      requireCondition(
        ["waiting", "active"].includes(room.status),
        409,
        "對局已結束。",
      );
      room.status = "aborted";
    } else if (action.type === "leave") {
      requireCondition(
        room.status !== "active",
        409,
        "對局中請保留座位；房主可終止對局。",
      );
      await db.query("DELETE FROM members WHERE room_id=$1 AND player_id=$2", [
        id,
        who.player_id,
      ]);
      const remaining = members.filter((m) => m.player_id !== who.player_id);
      if (!remaining.length && room.status === "waiting")
        room.status = "aborted";
      if (room.host_id === who.player_id && remaining.length)
        room.host_id = remaining[0].player_id;
    } else {
      requireCondition(room.status === "active", 409, "目前沒有進行中的對局。");
      const parsed = game.parseAction(action.action);
      if (parsed.type === "next")
        requireCondition(
          room.host_id === who.player_id,
          403,
          "只有房主能開始下一輪。",
        );
      try {
        room.state = game.transition(
          room.state,
          who.player_id,
          parsed,
          randomInt,
        );
      } catch (e) {
        requireCondition(
          false,
          400,
          e instanceof Error ? e.message : "無效操作",
        );
      }
      const result = game.result(room.state);
      if (result) {
        room.status = "finished";
        const matchId = randomUUID();
        await db.query(
          "INSERT INTO matches(id,room_id,game_id,rules_version) VALUES($1,$2,$3,$4)",
          [matchId, id, room.game_id, game.info.rulesVersion],
        );
        for (const m of members)
          await db.query(
            "INSERT INTO results(match_id,player_id,user_id,name,score,won) VALUES($1,$2,$3,$4,$5,$6)",
            [
              matchId,
              m.player_id,
              m.user_id,
              m.snapshot_name,
              result.scores[m.player_id],
              result.winners.includes(m.player_id),
            ],
          );
      }
    }
    await db.query(
      "UPDATE rooms SET state=$1,status=$2,host_id=$3,is_public=$4,version=version+1,updated_at=now() WHERE id=$5",
      [room.state, room.status, room.host_id, room.is_public, id],
    );
    await db.query(
      "INSERT INTO operations(room_id,operation_id,player_id,version) VALUES($1,$2,$3,$4)",
      [id, operation, who.player_id, room.version + 1],
    );
    return { left: action.type === "leave", duplicate: false };
  });
}
export async function heartbeat(room: string, player: string) {
  await pool.query(
    "UPDATE members SET last_seen=now() WHERE room_id=$1 AND player_id=$2",
    [room, player],
  );
}
export async function transferHosts() {
  return transaction(async (db) => {
    const rooms = await db.query(
      "SELECT r.* FROM rooms r JOIN members h ON h.room_id=r.id AND h.player_id=r.host_id WHERE r.status IN ('waiting','active','finished') AND h.last_seen<now()-interval '60 seconds' ORDER BY r.id FOR UPDATE OF r SKIP LOCKED",
    );
    const changed: string[] = [];
    for (const r of rooms.rows) {
      const candidate = (
        await db.query(
          "SELECT player_id FROM members WHERE room_id=$1 AND player_id<>$2 AND last_seen>now()-interval '45 seconds' ORDER BY position LIMIT 1",
          [r.id, r.host_id],
        )
      ).rows[0];
      if (candidate) {
        await db.query(
          "UPDATE rooms SET host_id=$1,version=version+1,updated_at=now() WHERE id=$2",
          [candidate.player_id, r.id],
        );
        changed.push(r.id);
      }
    }
    return changed;
  });
}
