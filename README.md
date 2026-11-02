# 交接不斷線（獨立網站）
Node 18+，零相依。後端代理 BizForm（API 金鑰只存在伺服器）、轉送 C.ai、提供網頁。

## 本機執行
1. 複製 `.env.example` 為 `.env`，填入 `BIZFORM_API_KEY`（Power BI、表單網址已預設）
2. `node server.js` → http://localhost:3000
   （`MOCK=1 node server.js` 用示範資料預覽）

## 部署（Render / Railway / 任何 Node 主機）
- Build：無　Start：`node server.js`
- 在平台的 Environment 設定 `.env.example` 裡的變數（金鑰不要寫進程式碼或 Git）
- 想加存取碼：設定 `SITE_PASSCODE`

## C.ai 串接
- `CAI_EMBED_URL`：C.ai 網頁聊天嵌入網址 → 「交接小幫手」頁直接嵌入
- `CAI_CHAT_ENDPOINT`（＋`CAI_API_KEY`）：若有對話 API，右下角小幫手會轉送到 C.ai；失敗時自動改用 BizForm 即時資料回答

## 資料流
瀏覽器 → /api/handovers → 伺服器以 x-api-key＋depotId 呼叫 BizForm（query ＋ 逐筆 GET，快取 60 秒）。

## C.ai WebChat（已發佈）
機器人 `handover_bot_003` 已在 C.ai 發佈；網站載入 C.ai 的 WebChat 小工具（右下角）。不需額外設定。

## 部署到 Render
1. 把本資料夾推到 GitHub（`.env` 不會被上傳）
2. Render → New → Blueprint（或 Web Service）→ 選該 repo，會讀取 `render.yaml`
3. 在 Render 的 Environment 貼上 `BIZFORM_API_KEY`（必填），`SITE_PASSCODE` 可選
4. Deploy 完成後即可使用；免費方案閒置會休眠，首次開啟約需 30–60 秒

## Vital CRM
- API：`Authorization: ApiKey <金鑰>`，路徑 `https://crm.vitalyun.com/<服務識別碼>/api/opportunities|customers|companies`
- 金鑰位置：CRM「管理 → 服務資訊 → 店點 ApiKey」。只貼在 Render 的 `CRM_API_KEY`
- 「CRM 商機」頁底部的「欄位檢查」會顯示 CRM 回傳的原始欄位，方便對欄位名稱

## 即時更新
每次開啟或重新整理網頁、切回分頁、每 60 秒，都會重新向 BizForm 與 CRM 取最新資料。
