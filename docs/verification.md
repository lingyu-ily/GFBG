# 驗收紀錄

## 2026-09-11 帳號註冊與登入改版驗收

- `npm run build`：TypeScript、Vite 前端與伺服器 bundle 通過。
- `npm test`：全部規則測試通過。
- `npm run test:integration`：16 個整合測試通過、1 個未設定 `PG_BIN` 的備份測試跳過。
- 已驗證 legacy 帳號停用與 Email 重用、帳密註冊登入、SMTP 失敗保留帳號、跨瀏覽器 Email 驗證、名稱開局快照、忘記／修改密碼及 session 撤銷。

## 2026-09-11 RustFS 會員頭像增量驗收

- `npm run build`：TypeScript、Vite 前端、含 Sharp 與 AWS S3 SDK 的伺服器 bundle 通過。
- `npm run test:integration`：15 個整合測試通過、1 個未設定 `PG_BIN` 的備份測試跳過。
- 本機假 S3 實際接收 path-style PUT／DELETE；已驗證 256×256 WebP、不可變快取、失敗回復、換圖清理、跨瀏覽器與 WebSocket 更新。
- 尚待以實際 RustFS Bucket、公開 HTTPS 網址及手機瀏覽器完成部署驗收。

## 2026-09-11 同房續局增量驗收

- `npm test`：36 個規則測試通過。
- `npm run build`：TypeScript、Vite 前端與伺服器 bundle 建置通過。
- `npm run test:integration`：14 個整合測試通過；同房返回準備大廳、全員取消準備、完成房房主轉移、連續兩場獨立戰績皆已驗證。
- 備份還原測試因本次環境未設定 `PG_BIN` 而跳過；下方 2026-09-10 的完整備份還原紀錄不受影響。

日期：2026-09-10。環境：Windows、Node.js 24.19.0；獨立測試 PostgreSQL 18.4，備份工具 PostgreSQL 18.6。未連接使用者既有 PostgreSQL 或 SMTP。

| 檢查 | 結果 |
| --- | --- |
| TypeScript 型別與正式前後端建置 | 通過 |
| 規則測試 | 12 組通過，含 60 場 2／4／6 人完整模擬 |
| 真實 PostgreSQL／HTTP／WebSocket／SMTP 整合 | 12 組通過，0 跳過 |
| `pg_dump` → 新資料庫 `pg_restore` | 帳號、session、token、房間快照、操作紀錄、戰績和遷移資料一致 |
| 正式依賴稽核 | `npm audit --omit=dev`：0 已知漏洞 |
| Compose 設定與 Unraid XML | 格式驗證通過 |
| 本機 HTTP 預覽 | `http://localhost:3000`，使用獨立開發資料庫 |

## 已驗證的關鍵行為

1. 21 張牌守恆、全部角色效果、保護與強制出牌、空牌庫、大臣排序、間諜加分與共同勝利。
2. 同時入房不超過 6 人；非法來源、非會員、過期版本被拒絕；重送操作只提交一次。
3. WebSocket 只傳本人視角；進行中牌局在重啟後保留原狀態；資料庫離線不產生假成功。
4. 本機 SMTP 實際投遞 Email 驗證與密碼重設信；驗證可跨瀏覽器但不建立登入、token 到期／重用被拒絕，帳密登入保留座位並可跨裝置重新加入。
5. 2／4／6 人透過 API 玩到完整結算；戰績一次寫入、訪客事後登入不回補；備份還原內容一致。

## 尚待部署環境驗收

- 本機 Docker Desktop 在啟動 Inference manager 時發生 listener 錯誤，無可用引擎，因此未完成 Docker image build／容器實跑。Compose／XML 靜態驗證不等同映像建置驗證。
- 尚未取得並設定實際 Unraid、PostgreSQL、SMTP 與網域，因此尚未部署，也未驗證正式 TLS、外部寄信及手機瀏覽器操作。
- 本次前端完成型別／建置與 HTTP 入口驗證；未執行瀏覽器畫面自動化測試。

正式驗收步驟見 README 的 Unraid 部署章節。對外部署前，應在 Unraid 完成映像建置、資料库遷移與跨裝置遊玩。
