import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { AppError, requireCondition } from "./errors.js";

const acceptedTypes = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const client = config.avatar
  ? new S3Client({
      endpoint: config.avatar.endpoint,
      region: config.avatar.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.avatar.accessKeyId,
        secretAccessKey: config.avatar.secretAccessKey,
      },
    })
  : null;
const storageDeadline = () => ({ abortSignal: AbortSignal.timeout(10_000) });

function requireAvatarConfig() {
  requireCondition(
    config.avatar && client,
    503,
    "頭像上傳尚未設定，請稍後再試。",
  );
  return { settings: config.avatar, client };
}

export function publicAvatarUrl(key: string | null | undefined) {
  if (!key || !config.avatar) return null;
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${config.avatar.publicBaseUrl}/${encoded}`;
}

export async function verifyAvatarStore() {
  if (!config.avatar || !client) return;
  try {
    await client.send(
      new HeadBucketCommand({ Bucket: config.avatar.bucket }),
      storageDeadline(),
    );
  } catch {
    throw new Error("無法存取 AVATAR_S3_BUCKET，請檢查 RustFS 連線、Bucket 與權限");
  }
}

async function convertAvatar(input: Buffer, contentType: string) {
  const expected = acceptedTypes.get(contentType);
  requireCondition(expected, 415, "只支援 JPEG、PNG 或 WebP 圖片。");
  requireCondition(input.length > 0, 400, "請選擇頭像圖片。");
  try {
    const source = sharp(input, {
      animated: false,
      limitInputPixels: 40_000_000,
    });
    const metadata = await source.metadata();
    requireCondition(
      metadata.format === expected && (metadata.pages || 1) === 1,
      400,
      "圖片格式不符或包含動畫，請改用靜態圖片。",
    );
    const output = await source
      .rotate()
      .resize(256, 256, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
    requireCondition(output.length <= 256 * 1024, 400, "處理後的頭像仍然過大。");
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "圖片無法讀取，請改用其他 JPEG、PNG 或 WebP 圖片。");
  }
}

async function deleteObject(key: string) {
  const { settings, client: s3 } = requireAvatarConfig();
  await s3.send(
    new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }),
    storageDeadline(),
  );
}

function logCleanupFailure(error: unknown) {
  console.error("頭像舊物件清理失敗", {
    code: (error as { name?: string })?.name || "S3_DELETE_FAILED",
  });
}

export async function saveAvatar(
  userId: string,
  input: Buffer,
  contentType: string,
) {
  const { settings, client: s3 } = requireAvatarConfig();
  const body = await convertAvatar(input, contentType);
  const key = `avatars/${randomUUID()}.webp`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        Body: body,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
      storageDeadline(),
    );
  } catch {
    throw new AppError(503, "頭像儲存服務暫時無法使用，請稍後重試。");
  }

  let oldKey: string | null = null;
  try {
    oldKey = await transaction(async (db) => {
      const user = (
        await db.query("SELECT avatar_key FROM users WHERE id=$1 FOR UPDATE", [
          userId,
        ])
      ).rows[0];
      requireCondition(user, 401, "登入會員才能設定頭像。");
      await db.query("UPDATE users SET avatar_key=$1 WHERE id=$2", [key, userId]);
      return user.avatar_key;
    });
  } catch (error) {
    await deleteObject(key).catch(logCleanupFailure);
    throw error;
  }
  if (oldKey) await deleteObject(oldKey).catch(logCleanupFailure);
  return publicAvatarUrl(key)!;
}

export async function removeAvatar(userId: string) {
  requireAvatarConfig();
  const oldKey = await transaction(async (db) => {
    const user = (
      await db.query("SELECT avatar_key FROM users WHERE id=$1 FOR UPDATE", [userId])
    ).rows[0];
    requireCondition(user, 401, "登入會員才能設定頭像。");
    await db.query("UPDATE users SET avatar_key=NULL WHERE id=$1", [userId]);
    return user.avatar_key as string | null;
  });
  if (oldKey) await deleteObject(oldKey).catch(logCleanupFailure);
}

export async function avatarRoomIds(userId: string) {
  return (
    await pool.query(
      "SELECT DISTINCT r.id FROM rooms r JOIN members m ON m.room_id=r.id JOIN players p ON p.id=m.player_id WHERE p.user_id=$1 AND r.status IN ('waiting','active')",
      [userId],
    )
  ).rows.map((row) => row.id as string);
}
