# 頁間｜閱讀筆記網站

一個手機和電腦都能使用的繁體中文閱讀筆記網頁。**不用安裝 Node.js，也不用寫指令**，直接把整個專案上傳 GitHub，就能用 GitHub Pages 開啟。

## 功能

- 新增、編輯、刪除書籍；記錄**書名**與選填的作者。
- 為每本書記錄多則筆記：**頁數**（選填）、**章節**（選填）與**筆記內容**（必填，可換行）。
- 搜尋書名、作者，以及書內的章節、頁數與筆記內容。
- 編輯、刪除筆記，按最近修改時間排序。
- 匯出 JSON 資料備份（目前只有匯出，**沒有匯入**）。
- 手機、平板、電腦自動排版。
- **雲端模式**：Supabase 登入、儲存，手機和電腦登入同一帳號讀取相同資料。
- **單機試用模式**：不設定 Supabase 也能體驗，但資料只存本機瀏覽器，**不能跨裝置同步**。

## 照做就能上線（不用終端機）

### 第 1 步｜建立 GitHub 專案

1. 登入 [GitHub](https://github.com/) → 右上角 `+` → `New repository`。
2. `Repository name` 填入 `reading-notes-app`（可以換成你喜歡的英文名稱）。
3. 選擇 `Public`。GitHub 免費方案公開儲存庫可使用 GitHub Pages；**公開的是網頁程式碼，不是你存在 Supabase 的個人筆記**。資料存取另有登入及 RLS 保護。
4. 按 `Create repository`。若選擇新增 README 也沒關係，但上傳時要處理同名檔案。

### 第 2 步｜上傳檔案（一定要先解壓縮）

1. 下載專案 ZIP 並**解壓縮**。
2. 進入 GitHub 新專案，按 `Add file` → `Upload files`（空白儲存庫可用 `uploading an existing file`）。
3. 將解壓縮後的 `reading-notes-app` **裡面所有檔案與資料夾**拖曳到瀏覽器上傳區。
4. 確認 **`index.html` 位於儲存庫最外層（根目錄）**，同一層有 `css/`、`js/`、`database/`、`assets/`、`README.md`。不要只上傳 ZIP。
5. 下方輸入例如 `Add reading journal app`，按 `Commit changes`（介面可能顯示 `Propose changes`）。

⚠️ 在 macOS 或 Windows 的檔案總管中，`.nojekyll` 是隱藏檔，不小心漏傳也不影響這個版本的主要功能。

### 第 3 步｜啟用 GitHub Pages

1. 進入此儲存庫上方的 `Settings`。
2. 左側 `Pages`。
3. `Build and deployment` → `Source` 選 `Deploy from a branch`。
4. `Branch` 選 `main`、資料夾選 `/ (root)` → `Save`。
5. 頁面出現 `Visit site` 後就可開啟。通常網址是：

   `https://你的GitHub帳號.github.io/reading-notes-app/`

此時若尚未設定 Supabase，你會看到「**單機試用模式**」。可先用手機開網站，測試新增書籍和筆記。上線發布可能需要數分鐘。

### 第 4 步｜建立 Supabase 雲端資料庫

1. 到 [Supabase](https://supabase.com/) 登入並建立新 Project。
2. 記住該專案設定的資料庫密碼（不要貼到網站程式或 GitHub）。
3. 專案建立後，左側 `SQL Editor` → `New query`。
4. 打開本專案的 `database/schema.sql`，複製**全部內容**貼進 SQL Editor，按 `Run`。
5. 確認沒有 SQL 錯誤。這會建立 `books`、`notes` 兩張資料表與 **RLS 安全規則**。

### 第 5 步｜將 Supabase 連到網站

1. Supabase 專案內找到 `Project URL` 和 `Publishable key`（某些介面路徑為 `Project Settings` → `API Keys`；舊專案也可使用 `anon public` key）。
2. 回 GitHub 儲存庫，進入 `js/config.js` → 右上方鉛筆 `Edit this file`。
3. 將 `supabaseUrl`、`supabasePublishableKey` 兩個引號中的範例字串，替換成 Supabase 顯示的實際值。保留引號與逗號，例如：

   ```js
   window.READING_NOTES_CONFIG = {
     supabaseUrl: "https://abcdefg.supabase.co",
     supabasePublishableKey: "sb_publishable_這裡貼上你的完整金鑰"
   };
   ```

4. 按 `Commit changes`。

**重要：只能填入 `Publishable key` 或 `anon public` key。絕對不可放入 `service_role`、`secret` key 或資料庫密碼！** 公開網站的這兩個允許放入前端的值會被瀏覽器看到，所以必須搭配 `database/schema.sql` 提供的 RLS 規則。

### 第 6 步｜設定登入信件的回跳網址

1. Supabase 專案 → `Authentication` → `URL Configuration`。
2. `Site URL` 設成你剛剛的 GitHub Pages 網址，例如：

   `https://你的GitHub帳號.github.io/reading-notes-app/`

3. 在 `Redirect URLs` 新增同一個網址（請包含最後面的 `/`），儲存。
4. `Authentication` → `Providers` → `Email`：確認 Email 登入允許使用。雲端 Supabase 專案通常預設要求驗證電子郵件。

**Supabase 寄信限制請先注意：** 截至 2026 年 11 月，Supabase 內建測試郵件服務**只允許寄給所屬組織的成員信箱**，而且整個專案限額約 **每小時 2 封**。你第一次自己試用，建議使用建立 Supabase 組織時的相同信箱註冊；要讓其他人註冊、正常收到驗證信及忘記密碼通知，需要另外設定自有 SMTP 郵件服務。也可以由專案管理者建立測試用帳號，但請勿為了方便而公開分享密碼。

### 第 7 步｜兩台裝置測試同步

1. 在電腦開 GitHub Pages 網址，重新整理，確認看到登入畫面（不再是單機試用）。
2. 用電子郵件註冊，若系統要求驗證，先到信箱點選驗證連結，再登入。
3. 新增一本書，輸入一則含頁數／章節的筆記並儲存。
4. 在手機用**同一個網頁網址、同一個帳號登入**，應會讀到同一本書和筆記。
5. 更新筆記後，切回另一台裝置按「更新」可取得最新內容；重新進入頁面時也會讀取雲端資料。

## 專案資料夾結構

```text
reading-notes-app/
├── index.html           網頁主畫面及表單
├── css/
│   └── style.css        樣式與手機版排版
├── js/
│   ├── app.js           書籍、筆記、搜尋、帳號、同步邏輯
│   └── config.js        Supabase 公開連線設定（你需填兩個值）
├── database/
│   └── schema.sql       Supabase 資料表與 RLS 權限規則
├── assets/
│   └── favicon.svg      頁間圖示
├── .nojekyll            GitHub Pages 設定（可忽略）
└── README.md            本安裝說明
```

## 使用時的重要提醒

**同步的真正條件：** GitHub Pages 只負責公開「網頁介面」。將筆記存在雲端並讓不同裝置登入的是 Supabase，不是 GitHub。

**單機試用資料不會自動移轉：** 設定 Supabase 後會切換成新的雲端帳號資料，原先單機試用的筆記不會自動上傳。請在切換前按「匯出備份」保留原始資料；本版不含備份匯入功能，若筆記已經很多，請先不要在試用模式正式使用。

**離線功能：** 單機試用模式一般可以在網頁已載入後操作，但仍需要可用的瀏覽器儲存空間；雲端模式需要網路，不能宣稱可以離線同步。

**資料與隱私：** 筆記對一般訪客不可直接讀取；Supabase RLS 依帳號隔離。這不是端對端加密，Supabase 專案管理者可以管理資料庫。請自行保護 Supabase、GitHub 帳號，且勿在網站前端放入任何私密金鑰。

**資料備份：** 「匯出備份」會下載含完整筆記的 JSON 檔案，請妥善保存。刪除書籍會一併刪除書內所有筆記且無法直接復原。

**費用：** GitHub Pages 可在符合使用條件時免費使用；Supabase 有免費方案與資源限制。請以兩家服務目前方案為準。

## 常見問題

**上傳後顯示 404？** 檢查 `index.html` 是否在根目錄、GitHub Pages 是否選 `main` + `/ (root)`，並稍等部署完成。

**網站一直顯示單機試用？** 檢查 GitHub `js/config.js` 是否已存入正確的 `https://....supabase.co` Project URL 和可公開的金鑰，並等待 Pages 更新。

**登入顯示 `Email not confirmed`？** 到信箱點驗證連結，並確認 Supabase 的 `Site URL`、`Redirect URLs` 已包含 GitHub Pages 網址。

**註冊出現 `Email address not authorized`？** Supabase 的內建測試寄信限制。請使用所屬組織成員的電子郵件測試，或設定自有 SMTP。

**登入後看不到筆記？** 確認使用相同帳號，也要確認 SQL 已成功執行。右下角同步狀態會顯示是否失敗；可按「更新」。

**能當真正的手機 App 安裝嗎？** 這個版本是適合手機的「網頁 App」。可透過手機瀏覽器的「加入主畫面」建立捷徑，但不是上架 App Store / Google Play 的原生應用程式。

## 參考官方說明

- [GitHub：上傳檔案](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [GitHub：設定 GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Supabase：RLS 資料安全](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase：Email 寄送與 SMTP 限制](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase：密碼登入](https://supabase.com/docs/guides/auth/passwords)
