# 古楓桌遊 GFBG

繁體中文私人桌遊平台，收錄新版《情書》、《暗影獵人》與《暗影奇襲：女王陛下的飛行船》。手機／電腦共用牌桌，訪客可直接入房，Email 登入保存完整對局戰績並可設定會員頭像。

**部署方式：一個 Node.js 應用程式容器，連接你現有的 PostgreSQL、SMTP 與 HTTPS 反向代理。** 不需要 MariaDB、Redis、Sites 或 Supabase。

## 在本機查看

需要 Node.js 24。以下預覽使用獨立的本機 PostgreSQL，完全不接觸正式資料庫。

```sh
npm ci
npm run build
npm run preview:local
```

開啟終端顯示的網址（預設 `http://localhost:3000`）。使用兩個不同瀏覽器或一般／無痕視窗可測試不同玩家；相同瀏覽器分頁會共用身份。預覽未設定 SMTP 時，Email 登入會明確顯示尚未開放。

預覽資料留在 `.local/`，按 Ctrl+C 同時關閉應用程式與測試 PostgreSQL。`embedded-postgres` 只用於開發／測試，正式映像不包含它。若 npm 阻擋安裝腳本，准許 `esbuild` 與當前平台的 `@embedded-postgres/*` 安裝腳本後重試。Linux 請用一般使用者執行本機預覽／整合測試。

### 連接自己的開發資料庫

1. 複製 `.env.example` 為 `.env`，填入專用 PostgreSQL 連線。
2. 設 `PUBLIC_URL=http://localhost:5173`、`TRUST_PROXY_HOPS=0`。
3. 執行 `npm run migrate`，再執行 `npm run dev`。

`npm run dev` 的前端為 5173，後端為 3000。如果需在其他裝置測試，設定正確的 PUBLIC_URL、Vite host 與代理；正式部署統一由單一 HTTPS origin 提供頁面、API 與 WebSocket。

## GitHub 自動建置 Docker

推送 main 後，由 GitHub Actions 測試、建置並發布 `ghcr.io/lingyu-ily/gfbg:latest`。Unraid 可直接拉取映像，無須本機建置。

請依 [GitHub Actions 與 GHCR 部署指南](docs/github-actions.md) 設定；使用 `compose.ghcr.yaml` 部署預建映像。下方 `compose.yaml` 流程則保留給需要自行建置的情況。

## 部署到 Unraid

### 1. 準備專用 PostgreSQL 資料庫

支援 PostgreSQL 14–18；部署時先執行 `SHOW server_version;` 確認現有版本。以管理員透過資料庫管理工具執行以下一次性初始化，密碼自行替換：

```sql
CREATE ROLE tablefolk LOGIN PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE tablefolk OWNER tablefolk;
```

切換到新建的 `tablefolk` 資料庫，再執行：

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO tablefolk;
```

應用程式使用 `tablefolk` 角色，不能使用現有服務的共用資料庫或管理員帳號。PostgreSQL 的網路規則需允許應用程式容器連線；只開放可信內網。外部資料庫若要求 TLS，在連線 URL 設定適合你憑證的 TLS 選項，不關閉憑證驗證。

### 2. 放入專案並設定環境

把原始碼放在 Unraid，例如 `/mnt/user/appdata/tablefolk/source`。不要上傳本機的 `node_modules`、`dist`、`.local` 或含密碼的開發 `.env`。

複製 `.env.example` 為 `.env`，至少填：

| 設定 | 用途 |
| --- | --- |
| `PUBLIC_URL` | 實際 HTTPS 網址，例如 `https://games.example.com`；不支援子路徑部署 |
| `DATABASE_URL` | `postgresql://tablefolk:密碼@資料庫主機:5432/tablefolk`；密碼特殊字元須 URL 編碼 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | 587 搭配 false（強制 STARTTLS）；465 搭配 true |
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | 現有寄信服務的帳密與核准寄件者 |
| `AVATAR_S3_ENDPOINT` / `AVATAR_S3_REGION` | RustFS S3 API（通常為內網 `http://rustfs:9000`）與區域（預設 `us-east-1`） |
| `AVATAR_S3_BUCKET` / `AVATAR_S3_ACCESS_KEY_ID` / `AVATAR_S3_SECRET_ACCESS_KEY` | 預先建立的專用 Bucket 與 GFBG service account |
| `AVATAR_PUBLIC_BASE_URL` | 公開 HTTPS Bucket 路徑，例如 `https://assets.example.com/gfbg-avatars` |
| `TRUST_PROXY_HOPS` | 實際代理層數；一般一層填 1，直連開發填 0 |

`.env` 限制為管理者可讀，勿加入 Git。`HOST_PORT` 預設 3000，可調整為未占用埠。正式環境必須是 HTTPS，登入連結使用固定的 PUBLIC_URL 產生。未提供 SMTP 主機或寄件者時訪客功能仍正常。六項頭像設定全空時停用頭像上傳；只填部分會拒絕啟動並列出缺少項目。

在 RustFS 預先建立 `gfbg-avatars` Bucket。Bucket Policy 只對外允許 `s3:GetObject` 到 `arn:aws:s3:::gfbg-avatars/avatars/*`，不要公開列出 Bucket。另建立 GFBG 專用 service account：Bucket 層只給啟動檢查需要的 `s3:ListBucket`，物件層只給 `avatars/*` 的 `s3:PutObject` 與 `s3:DeleteObject`。應用程式不使用 RustFS root credentials，也不會自動建立 Bucket。

### 3. 建置、遷移、啟動

在專案目錄執行：

```sh
docker compose build
docker compose run --rm --no-deps tabletop node dist/server/migrate.js
docker compose up -d
```

Compose 只啟動應用程式，不建立 PostgreSQL 或 RustFS。帳號保存 RustFS 物件 key，圖片本體在 RustFS，因此不需要應用程式資料卷。採非 root、唯讀檔案系統與受限暫存目錄；保留啟動與錯誤碼日誌，不記錄秘密手牌、驗證 token 或帳密。

**使用 Unraid WebUI 管理的替代方式：** 先依 GHCR 部署指南登入、拉取映像並執行一次性遷移，再把 `deploy/unraid-template.xml` 放到 `/boot/config/plugins/dockerMan/templates-user/my-tablefolk.xml`，從 Docker → Add Container 選擇模板，填入連線設定，將 WebUI 改為實際網域。啟動後打開 Auto-Start。不要同時用 Compose 和 WebUI 啟動同名服務。

### 4. 接上既有 HTTPS 入口

反向代理導向 Unraid 的應用程式主機埠。開啟 WebSocket Upgrade，原樣保留 Origin，且轉送可信的 `X-Forwarded-For`。只允許代理存取主機埠，避免客戶端偽造來源 IP。Nginx 範例位於 `deploy/nginx-location.conf`；既有 HTTPS 和憑證由你的代理繼續管理。

初次完成後依序驗收：

1. 實際網域 `/api/health` 回傳 `{"status":"ok"}`。
2. 手機與電腦各以不同身份加入同房，準備後開始。
3. 出牌同步且各自只看得到自己的手牌；重新整理仍在原座位。
4. Email 收信後於提出要求的同一瀏覽器按「確認登入」，保留座位；完成對局後查看戰績。
5. 登入會員上傳頭像，確認等待室與三款遊戲同步顯示；換圖、移除與重啟後狀態正確。

未填入你的實際連線設定、完成這組實機驗收前，不能視為已上線。

## 遊戲操作與身份

所有人準備後才能開始，房間開局後鎖定座位。《情書》由房主指定第一輪先手，後續由本輪勝者先手，平手在勝者間隨機選擇；每輪結束由房主開始下一輪。《暗影獵人》在 4–8 人準備完成後隨機決定先手；《暗影奇襲：女王陛下的飛行船》支援 4–10 人並同樣由伺服器隨機決定先手。

《情書》每回合由伺服器自動抽牌，玩家選手牌、目標與猜測後確認出牌；大臣需選保留牌及牌庫底順序。《暗影獵人》依提示完成移動、可選地點行動與可選攻擊；身分、隱士牌及未使用角色均由伺服器依玩家視角過濾。飛行船版使用獨立角色與牌庫：擲出 10 登船，外圍攻擊範圍沿逆時針延伸，推理牌內容只傳給抽牌者與接收者。對局結束後由房主帶全桌回到準備大廳；房號、遊戲與座位保留，全員重新準備後可開始下一場。

訪客身份存於安全 Cookie。重新整理、關閉後重開同一瀏覽器可恢復；清除 Cookie 或換裝置不能憑暱稱取回訪客座位。登入玩家可在另一瀏覽器登入後，透過大廳「你的牌桌還在」重新加入原座位。登出會撤銷目前 session，之前的座位仍屬原帳號。

同一帳號不能在同一進行中房間占兩個座位。訪客對局結束前登入，會將當局歸入帳號；結束後才登入不回補過去戰績。共同獲勝都計為勝利。終止對局不產生戰績。

WebSocket 每 15 秒檢查連線。房主超過 60 秒沒有有效連線活動，轉交最近仍在線且座次最前的玩家；所有人都離線則保留房間。輪到離線玩家時不代打，其他玩家可等其恢復，或由房主終止整場。

## 測試

```sh
npm run build
npm test
npm run test:integration
npm audit --omit=dev
```

規則測試涵蓋《情書》10 種角色與 21 張牌、《暗影獵人》20 名角色與三副各 16 張牌，以及飛行船版 30 名角色、七個地點、三副各 20 張牌、隱藏資訊和 4／6／8／9／10 人完整模擬。整合測試使用獨立的真實 PostgreSQL、本機 SMTP 接收器與假 S3 HTTP 服務，執行 HTTP／WebSocket 客戶端、三款遊戲的完整對局、登入、會員頭像、交易競爭及故障恢復；不寄送外部郵件，不連接正式 PostgreSQL 或 RustFS。

測試 PostgreSQL 資料留在 `.local/test-pg-*` 供失敗排查，測試結束即停止。這些自動測試不能替代實際 Unraid 的 HTTPS、SMTP 和手機驗收。

備份／還原整合測試另需 PostgreSQL 18 或更新版本的 `pg_dump`、`pg_restore`。將 `PG_BIN` 指向這兩個程式所在目錄，再執行整合測試。未設定會明確跳過該項；其他整合測試仍執行。例如 PowerShell：

```powershell
$env:PG_BIN='C:\Program Files\PostgreSQL\18\bin'
npm run test:integration
```

工具可從 [EDB 官方二進位下載頁](https://www.enterprisedb.com/download-postgresql-binaries)取得。備份測試只還原到自行建立的測試資料庫，不覆蓋既有資料。

## 備份、升級與還原

應用程式不自動在正式啟動時執行遷移，`AUTO_MIGRATE=false`。遷移在 PostgreSQL 交易及 advisory lock 中執行，已套用檔案不可修改；新增連號 SQL。新遊戲規則需要升版本並保留舊狀態讀取相容性，或等舊對局結束才升級。

升級：先通知玩家，停止應用程式，以 PostgreSQL 工具備份專用資料庫，保留舊映像；建置新版、執行遷移，再啟動。使用與伺服器相同或較新的 PostgreSQL 備份工具。密碼使用受限權限的 `.pgpass`／secret，避免寫在指令歷史。

```sh
pg_dump -h DB_HOST -U tablefolk -d tablefolk -Fc -f tablefolk-backup.dump
pg_restore --list tablefolk-backup.dump
```

定期把備份存到不同儲存裝置並測試還原。還原先停應用程式，用管理工具建立新的空資料庫 `tablefolk_restore`、指定 owner，再執行：

```sh
pg_restore -h DB_HOST -U tablefolk -d tablefolk_restore --no-owner --no-acl --exit-on-error tablefolk-backup.dump
```

驗證後將 DATABASE_URL 指向還原庫並啟動相容版本。不要對共用資料庫使用 `--clean`。若升級後需回退，使用舊映像搭配升級前備份；不對未知相容性結構直接降版。

## 新增桌遊

1. 在 `shared/` 定義遊戲專屬 action、view 與規則版本。
2. 在 `server/games/` 實作 `GameDefinition`，包括輸入解析、初始狀態、合法操作、狀態轉移、玩家視角與結算。
3. 在伺服器 registry 註冊遊戲；在客戶端桌面 registry 註冊對應元件。房間、session、交易與 WebSocket 不需重寫。
4. 加入規則測試和私密資訊測試。完成後遊戲大廳會由 registry 顯示新項目。

目前後端以房間列鎖保護操作，操作 ID 防止重複套用，state version 拒絕過時指令；只有交易成功才廣播。Session、角色與戰績使用關聯表，遊戲快照使用版本化 JSONB。第一版是單一應用程式實例，Redis 跨實例同步尚未加入。

玩法來源：《情書》使用 [Z-Man 官方新版規則](https://cdn.svc.asmodee.net/production-zman/uploads/2024/09/LL_Rulebook_with_Bag-1.pdf)；《暗影獵人》使用 [Z-Man 2016 官方規則](https://images-cdn.zmangames.com/us-east-1/filer_public/64/5b/645bebeb-6bef-4d62-8d92-b9ca65450e85/shadow-hunter-rules.pdf)，並採同字首新舊角色隨機二選一；飛行船版依專案隨附說明所記錄的非官方英文 v2 規則實作，固定規則版本為 `shadow-raiders-queen-majesty-v2-unofficial-v1`。所有卡面與介面皆為自製文字／CSS 視覺，未使用官方角色插畫、商標素材或卡牌掃描。
