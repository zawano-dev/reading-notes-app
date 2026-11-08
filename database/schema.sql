-- 頁間 Reading Journal｜Supabase SQL Editor：整段貼上後 Run
-- 本檔包含資料表、索引、RLS（資料列層級安全性）及各操作的權限規則。
-- 無論網站原始碼是否公開，都只允許「已登入者」操作「自己」的資料。

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  author text not null default '' check (char_length(author) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  page_number integer check (page_number is null or page_number between 1 and 9999999),
  chapter text not null default '' check (char_length(chapter) <= 180),
  content text not null check (char_length(btrim(content)) between 1 and 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists books_user_id_idx on public.books (user_id);
create index if not exists notes_user_id_idx on public.notes (user_id);
create index if not exists notes_book_id_idx on public.notes (book_id);

alter table public.books enable row level security;
alter table public.notes enable row level security;

-- 限縮至已登入身分；匿名訪客無法透過 API 存取資料。
revoke all on table public.books from anon, authenticated;
revoke all on table public.notes from anon, authenticated;
grant select, insert, update, delete on public.books to authenticated;
grant select, insert, update, delete on public.notes to authenticated;

-- 重複執行這份 SQL 時，先清理舊版同名策略，避免重複建立失敗。
drop policy if exists "books_select_own" on public.books;
drop policy if exists "books_insert_own" on public.books;
drop policy if exists "books_update_own" on public.books;
drop policy if exists "books_delete_own" on public.books;
drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;

create policy "books_select_own" on public.books
  for select to authenticated using (user_id = (select auth.uid()));
create policy "books_insert_own" on public.books
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "books_update_own" on public.books
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "books_delete_own" on public.books
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "notes_select_own" on public.notes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notes_insert_own" on public.notes
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.books
      where books.id = book_id and books.user_id = (select auth.uid())
    )
  );
create policy "notes_update_own" on public.notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.books
      where books.id = book_id and books.user_id = (select auth.uid())
    )
  );
create policy "notes_delete_own" on public.notes
  for delete to authenticated using (user_id = (select auth.uid()));
