# 實作邊界與資料流程

## 原則

單一 Node.js 實例提供靜態頁面、HTTP API 與唯讀 WebSocket。PostgreSQL 是遊戲與帳號關聯的權威資料來源，WebSocket 連線清單可隨時重建；會員頭像本體使用外部 RustFS，PostgreSQL 只保存目前物件 key。房間可承載多場完整對局；每次結算建立獨立 match 與戰績，房主可保留原座位並帶全桌回到準備大廳。

## 模組邊界

- `shared/game.ts`：泛型 `GameDefinition<State, Action, View>` 合約。
- `server/games/registry.ts` 與 `client/games.tsx`：伺服器規則模組／客戶端桌面模組註冊入口。
- `shared/room.ts`：房間協定只包裝不透明遊戲狀態與 action，不依賴情書。
- `server/rooms.ts`：房間列鎖、座位、操作去重、權限、交易與戰績。
- `server/games/love-letter.ts`：純規則轉移，隨機數由後端 `crypto.randomInt` 注入，測試可用固定種子。

每款遊戲的 `parseAction` 驗證其 payload，`legalActions` 回傳可操作選項，`playerView` 過濾隱藏狀態。公開 room schema、session、資料表與 WebSocket 都不隨卡牌角色變化。

## HTTP 與連線介面

| 類別 | 介面 |
| --- | --- |
| 啟動 | `GET /api/health`、`GET /api/me`、`GET /api/games` |
| 身份 | `POST /api/profile`、`POST/DELETE /api/profile/avatar`、`POST /api/auth/request`、`POST /api/auth/confirm`、`POST /api/auth/logout` |
| 房間 | `POST /api/rooms`、`POST /api/rooms/join`、`GET /api/rooms/:id`、`POST /api/rooms/:id/actions` |
| 戰績 | `GET /api/history`，只回傳當前帳號的最多 100 場最近對局，總數與勝率計入全部戰績 |
| 同步 | `GET /ws?room=UUID` Upgrade；session Cookie 和 Origin 驗證後只訂閱本人視角 |

所有 POST 需要 `Origin === PUBLIC_URL origin` 及 `X-CSRF-Token`。`/api/me` 回傳目前 session 的 CSRF token。不要把 session cookie 或 Email 登入 token 放入 query string。

會員頭像上傳使用原始 JPEG、PNG 或 WebP body，經後端限制大小、解碼、置中裁切及轉成 256×256 WebP 後，才以 UUID key 寫入 RustFS。RustFS Bucket 對外只公開 `avatars/*` 的讀取；寫入憑證只存在伺服器環境。換圖先寫新物件、再切換資料庫 key，最後刪除舊物件，避免失敗時留下失效頭像。

房間操作格式：

```json
{
  "operationId": "唯一 UUID",
  "version": 12,
  "action": { "type": "game", "action": { "type": "play", "card": "1-0", "target": "玩家 UUID", "guess": 9 } }
}
```

外層 action 支援 `ready`、`start`、`returnToLobby`、`leave`、`abort` 和 `game`。`returnToLobby` 只允許房主在完整結算後使用，會清除遊戲快照並重設全員準備狀態。回合間的 `next` 是房主操作；其他遊戲可以沿用此共用控制語意。

WebSocket 消息為 `{type:"room",room:RoomView}` 或 `{type:"error",error:string}`。WebSocket 不接受遊戲寫入；HTTP 是唯一寫入通道。用版本避免舊快照覆蓋新狀態；失去廣播可再次 GET 取得完整最新視角，不依賴重放一串事件。

## 一次操作的交易

1. `SELECT ... FOR UPDATE` 鎖定房間，檢查會員與操作 ID。相同會員重送已提交 ID 直接成功，不重新出牌。
2. 比較 room version，驗證當前階段、玩家及遊戲 action；纯規則轉移產生下一狀態。
3. 同交易保存 state、version、operation；若完局，同時寫入 match 和 results（唯一約束避免重複）。
4. COMMIT 成功後回應與廣播。資料庫錯誤不回傳成功；若成功回應在網路中遺失，客戶端使用同一 operation ID 重試。

登入歸屬會鎖住該玩家進行中的房間，與結算序列化。先結算再登入不回補；先登入再結算會保存帳號。戰績的 user_id 在結算時固定，不透過動態 JOIN 讓日後登入追溯訪客戰績。

## 部署與擴展限制

目前只支援一個應用程式實例。即使資料庫鎖能防止並行寫入，跨實例廣播仍需額外訊息層，不能直接增加 replicas。沒有 Redis 依賴，也沒有在 Node.js 記憶體中保存權威牌庫。

Cookie session 到期 30 天；Email token 到期 15 分鐘。訪客 session 過期或被清除就無法只靠暱稱恢復。對局不設自動代打或逾時敗局。

升級規則時不得直接讓既有 JSONB 快照改套不相容新規則。保留舊版本解碼器／規則，或等進行中對局結束才切換。第一版沒有管理後台、對局永久清理排程與多機協調。
