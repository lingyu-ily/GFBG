# GitHub Actions：測試、建置與 GHCR 發布

儲存庫：`lingyu-ily/GFBG`  
Docker 映像：`ghcr.io/lingyu-ily/gfbg`  
平台：`linux/amd64`（Unraid x86-64）。

## 觸發方式

| 事件 | 行為 |
| --- | --- |
| PR 指向 main | 建置、規則／整合測試、Docker 建置與容器健康驗證；不登入 GHCR、不發布 |
| 推送 main | 全部驗證通過後發布 latest 與 sha-完整提交SHA |
| 推送 v 開頭標籤，例如 v1.0.0 | 發布 v1.0.0 與 sha-完整提交SHA，不改動 latest |
| Actions → Run workflow | 可手動重跑；只有 main 或標籤可發布 |

`latest` 代表 main 最近成功發布的版本。正式使用可指定版本標籤或 Actions 摘要中的 digest，方便回退。不要重新指定已發布的版本標籤。

## 第一次推送後

1. 在 GitHub 的 Actions 開啟 **Test and publish Docker image**，確認兩個 job 都成功。
2. 在儲存庫的 Packages 找到 `gfbg`。GHCR 新 package 預設私人；本 workflow 不變更其可見性。
3. Workflow 使用內建 `GITHUB_TOKEN` 與 job 的 `packages: write` 權限，不需要另存 PAT。若組織政策限制 Actions 發布，需由管理者允許。若同名 package 原已存在，需在該 package 的 Manage Actions access 授予此儲存庫存取權。
4. 以私人映像部署時，在 Unraid 使用具 `read:packages` 的 GitHub classic PAT 登入 GHCR；token 透過 `--password-stdin` 輸入，不寫入 Compose 或儲存庫。組織若有 SSO，需另外授權此 token。

資料庫、SMTP 密碼只在 Unraid 的環境設定中使用；CI 使用臨時資料庫與本機郵件接收器，沒有正式服務憑證。

## Unraid 拉取與啟動

Unraid 只需 `compose.ghcr.yaml` 與依 `.env.example` 建立的 `.env`。先依 README 建立專用 PostgreSQL 資料庫，填好連線／SMTP／HTTPS 網址。

預設拉取 latest；建議在 `.env` 明確設定版本，例如：

```dotenv
GFBG_IMAGE=ghcr.io/lingyu-ily/gfbg:v1.0.0
```

在已有 GHCR 登入憑證的 Unraid 終端執行：

```sh
docker compose -f compose.ghcr.yaml pull
docker compose -f compose.ghcr.yaml run --rm --no-deps tabletop node dist/server/migrate.js
docker compose -f compose.ghcr.yaml up -d
```

使用 Unraid WebUI 時，模板的 Repository 已指向 `ghcr.io/lingyu-ily/gfbg:latest`；可改成版本 tag。容器名稱維持 `tablefolk`。Compose 與 WebUI 選一種管理，不同時建立同名容器。

更新前先備份資料庫，停止舊應用程式，再拉取、遷移與啟動。工作流程只發布映像，不會登入 Unraid、執行正式資料庫遷移或自動重啟正式服務。

## CI 驗證內容

Node.js 24 建置／型別檢查、規則測試、真實 PostgreSQL／SMTP／WebSocket 整合測試，包含 pg_dump／pg_restore。備份工具使用官方 `postgres:18` 映像，並透過 runner 的 host network 存取獨立測試資料庫。

Docker job 建置既有 Dockerfile，在獨立 Docker network 中建立臨時 PostgreSQL、重複執行遷移、啟動唯讀應用程式容器，確認 health API 與網頁。成功後使用相同來源與建置快取發布映像；失敗不發布。第三方 actions 固定完整 commit SHA。

本機的 workflow 語法驗證不代表已在 GitHub 執行成功；首次推送後以 Actions 的 job 結果與 digest 為準。
