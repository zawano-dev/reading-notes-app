-- 頁間 v5｜單篇公開分享（僅需在現有 Supabase 專案執行一次）
-- 不改動既有 books / notes 欄位與 RLS；切勿刪除或重建原資料表。
-- 公開資料只存放在獨立快照表；訪客不能直接查詢任何資料表。

create table if not exists public.note_shares (
  token uuid primary key default gen_random_uuid(),
  note_id uuid not null unique references public.notes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  book_title text not null,
  book_author text not null default '',
  chapter text not null default '',
  page_number integer,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists note_shares_owner_idx on public.note_shares(owner_id);
alter table public.note_shares enable row level security;
-- 絕不對 anon、authenticated 公開 note_shares 資料表：連已分享筆記也無法批次列出。
revoke all on table public.note_shares from public, anon, authenticated;

-- 只有筆記擁有者能建立/更新該篇筆記的公開快照，重複操作保持相同網址。
create or replace function public.share_publish(p_note_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_note record;
  v_token uuid;
begin
  if v_user is null then
    raise exception '請先登入。' using errcode = '42501';
  end if;

  select n.id, n.content, n.chapter, n.page_number, b.title, b.author
  into v_note
  from public.notes as n
  join public.books as b on b.id = n.book_id
  where n.id = p_note_id and n.user_id = v_user and b.user_id = v_user;

  if not found then
    raise exception '找不到這則筆記，或沒有分享權限。' using errcode = '42501';
  end if;

  insert into public.note_shares
    (note_id, owner_id, book_title, book_author, chapter, page_number, content)
  values
    (v_note.id, v_user, v_note.title, v_note.author, v_note.chapter, v_note.page_number, v_note.content)
  on conflict (note_id) do update set
    book_title = excluded.book_title,
    book_author = excluded.book_author,
    chapter = excluded.chapter,
    page_number = excluded.page_number,
    content = excluded.content,
    updated_at = now()
  returning token into v_token;

  return v_token;
end;
$$;

-- 擁有者查看指定筆記目前是否有分享連結；無法查看其他人的連結。
create or replace function public.share_status(p_note_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.token
  from public.note_shares as s
  join public.notes as n on n.id = s.note_id
  where s.note_id = p_note_id and n.user_id = auth.uid() and s.owner_id = auth.uid();
$$;

-- 取消公開會直接刪除分享快照，舊連結立刻失效。
create or replace function public.share_revoke(p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if auth.uid() is null then
    raise exception '請先登入。' using errcode = '42501';
  end if;
  delete from public.note_shares as s
  where s.note_id = p_note_id
    and s.owner_id = auth.uid()
    and exists (
      select 1 from public.notes as n
      where n.id = s.note_id and n.user_id = auth.uid()
    );
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- 訪客唯一可用的讀取入口：必須持有完整、不可猜測的 UUID token。
-- 不傳回原筆記 ID、書籍 ID、擁有者 ID 或其他私人筆記。
create or replace function public.share_read(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'book_title', s.book_title,
    'book_author', s.book_author,
    'chapter', s.chapter,
    'page_number', s.page_number,
    'content', s.content,
    'created_at', s.created_at
  )
  from public.note_shares as s
  where s.token = p_token;
$$;

-- PostgreSQL 函式預設可能讓 PUBLIC 執行：明確逐項撤銷再授權。
revoke all on function public.share_publish(uuid) from public, anon, authenticated;
revoke all on function public.share_status(uuid) from public, anon, authenticated;
revoke all on function public.share_revoke(uuid) from public, anon, authenticated;
revoke all on function public.share_read(uuid) from public, anon, authenticated;

grant execute on function public.share_publish(uuid) to authenticated;
grant execute on function public.share_status(uuid) to authenticated;
grant execute on function public.share_revoke(uuid) to authenticated;
grant execute on function public.share_read(uuid) to anon, authenticated;
