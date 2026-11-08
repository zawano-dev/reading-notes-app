// 在 Supabase 後台複製「Project URL」與「Publishable key」（或舊版 anon public key）。
// 請勿把 service_role / secret key 放進此檔案。
// 此設定檔會公開在 GitHub Pages 上；這對 publishable / anon key 是正常的，資料安全靠 SQL 的 RLS 規則。
window.READING_NOTES_CONFIG = {
  supabaseUrl: "請填入_SUPABASE_PROJECT_URL",
  supabasePublishableKey: "請填入_SUPABASE_PUBLISHABLE_KEY"
};
