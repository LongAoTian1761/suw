-- ===========================================================================
--  给老师开批改权限 —— 硕士宏观（suw）
--
--  用法：在**这个站点对应的 Supabase 项目**里，SQL Editor → New query
--  → 全文粘贴 → Run。脚本可以重复运行，不会重复插入。
--
--  按顺序做三件事：建 teachers 表与权限 → 把老师加进名单 → 核对。
--  两步之间不用手动分开，一次 Run 到底就行。
-- ===========================================================================

-- ===========================================================================
--  小补丁 v4：让老师能用自己的账号在网页上批改
--
--  粘进 SQL Editor 跑一次即可。跑完之后：
--   1. 把老师的邮箱加进名单（文件最后一行，改成老师的邮箱再跑一次）
--   2. 在 Supabase 左侧 Authentication → Users → Invite user，邀请老师
--   3. 老师收到邮件设好密码后，打开 你的网址/admin.html 登录就能批改
-- ===========================================================================

create table if not exists public.teachers (
  email      text primary key,
  note       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.teachers enable row level security;
revoke all on public.teachers from anon, authenticated;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teachers t
    where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

revoke all on public.submissions from authenticated;
grant select (
  id, created_at, updated_at, exercise, author, author_note, title, body, tags,
  attachments, status, helpful, feedback, grade, graded_at, revision
) on public.submissions to authenticated;
grant update (status, grade, feedback, graded_at) on public.submissions to authenticated;
grant delete on public.submissions to authenticated;
grant execute on function public.can_edit(uuid) to authenticated;

drop policy if exists "teachers can read every submission" on public.submissions;
create policy "teachers can read every submission"
  on public.submissions
  for select
  to authenticated
  using (public.is_teacher());

drop policy if exists "teachers can grade" on public.submissions;
create policy "teachers can grade"
  on public.submissions
  for update
  to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "teachers can delete" on public.submissions;
create policy "teachers can delete"
  on public.submissions
  for delete
  to authenticated
  using (public.is_teacher());

-- ↓↓↓ 把下面这行的邮箱换成老师的，再单独跑一次 ↓↓↓
-- insert into public.teachers (email, note)
-- values ('teacher@example.edu', '任课老师')
-- on conflict (email) do nothing;


-- ----------------------------------------------------------------
--  第 2 步：把老师加进名单（换邮箱就改这里，可以写多行）
-- ----------------------------------------------------------------
insert into public.teachers (email) values ('suiber@163.com')
on conflict do nothing;

-- ----------------------------------------------------------------
--  第 3 步：核对名单，应该能看到老师的邮箱
-- ----------------------------------------------------------------
select * from public.teachers;
