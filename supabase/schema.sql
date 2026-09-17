-- ===========================================================================
--  国际宏观经济学 · 课后题与解答 — 数据库结构
--  版本 2（2026-09-17）：新增设备令牌、修改 / 撤回、老师批改
--
--  在 Supabase 控制台里：左侧 SQL Editor → New query → 全文粘贴 → Run。
--  这段脚本**可以重复运行**：第一次是建表，之后每次运行都是升级，
--  不会丢数据、也不会报错。改动过结构之后重跑它就行。
--
--  设计要点
--    · 同学用浏览器里的公开密钥直接写入，不需要注册、不需要登录。
--    · anon 只能新增；只能改「自己那台设备交的」作业，靠设备令牌识别。
--    · 私密列（设备令牌、老师给的等级）对匿名读取完全不可见。
--    · 未发布 / 已撤下的作业对外读不到。
-- ===========================================================================

-- --------------------------------------------------------------- 1. 表 ---

create table if not exists public.submissions (
  id           uuid primary key,
  created_at   timestamptz not null default now(),
  exercise     text        not null,
  author       text        not null,
  author_note  text        not null default '',
  title        text        not null default '',
  body         text        not null,
  tags         text[]      not null default '{}',
  attachments  jsonb       not null default '[]'::jsonb,
  status       text        not null default 'verified',
  helpful      integer     not null default 0,

  -- 手机 / 电脑上生成的一串随机令牌，用来证明「这条是我交的」
  edit_token   text        not null default '',
  -- 老师批改
  feedback     text        not null default '',
  grade        text        not null default '',
  graded_at    timestamptz,
  -- 同学自己改过几次
  revision     integer     not null default 1,
  updated_at   timestamptz not null default now(),

  constraint submissions_status_allowed
    check (status in ('verified', 'peer', 'alternative', 'pending', 'rejected', 'withdrawn')),
  constraint submissions_body_len
    check (char_length(body) between 10 and 20000),
  constraint submissions_author_len
    check (char_length(author) between 1 and 60),
  constraint submissions_exercise_len
    check (char_length(exercise) between 1 and 12),
  constraint submissions_token_len
    -- 空令牌是允许的：升级之前提交的老记录拿不到令牌，它们只是不能再被学生修改。
    check (edit_token = '' or char_length(edit_token) between 16 and 200),
  constraint submissions_grade_len
    check (char_length(grade) <= 20),
  constraint submissions_feedback_len
    check (char_length(feedback) <= 4000)
);

-- 从旧版本升级上来的表，把这些列补上
alter table public.submissions add column if not exists edit_token text not null default '';
alter table public.submissions add column if not exists feedback   text not null default '';
alter table public.submissions add column if not exists grade      text not null default '';
alter table public.submissions add column if not exists graded_at  timestamptz;
alter table public.submissions add column if not exists revision   integer not null default 1;
alter table public.submissions add column if not exists updated_at timestamptz not null default now();

alter table public.submissions drop constraint if exists submissions_status_allowed;
alter table public.submissions add constraint submissions_status_allowed
  check (status in ('verified', 'peer', 'alternative', 'pending', 'rejected', 'withdrawn'));

-- 长度限制放在表约束里，这样策略本身不必去碰「隐藏列」，
-- 也就不会遇到列级授权和 RLS 表达式的相互牵制。
alter table public.submissions drop constraint if exists submissions_token_len;
alter table public.submissions add constraint submissions_token_len
  check (edit_token = '' or char_length(edit_token) between 16 and 200);
alter table public.submissions drop constraint if exists submissions_grade_len;
alter table public.submissions add constraint submissions_grade_len
  check (char_length(grade) <= 20);
alter table public.submissions drop constraint if exists submissions_feedback_len;
alter table public.submissions add constraint submissions_feedback_len
  check (char_length(feedback) <= 4000);

create index if not exists submissions_exercise_idx
  on public.submissions (exercise);

create index if not exists submissions_status_created_idx
  on public.submissions (status, created_at desc);

create index if not exists submissions_token_idx
  on public.submissions (edit_token);

-- ------------------------------------------------------- 2. 行级权限 ---

alter table public.submissions enable row level security;

-- 从请求头里取「设备令牌」，用来判断这条作业是不是他交的
create or replace function public.current_edit_token()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-edit-token',
    ''
  )
$$;

-- 新增：只能写入已发布状态，且必须带上够长的设备令牌
drop policy if exists "anon can submit homework" on public.submissions;
create policy "anon can submit homework"
  on public.submissions
  for insert
  to anon
  with check (
    -- 默认：提交后立刻展示。
    -- 想让老师先审一遍再放，把 'verified' 改成 'pending'，
    -- 同时把 data/course.json 里的 autoApprove 改成 false。
    status = 'verified'
  );

-- 判断「这条作业是不是这台设备交的」。
-- 写成 security definer，函数内部才有权读 edit_token 这一隐藏列，
-- 而策略表达式里只出现 id，不碰任何没授权的列。
create or replace function public.can_edit(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.submissions s
    where s.id = p_id
      and char_length(public.current_edit_token()) >= 16
      and s.edit_token = public.current_edit_token()
  )
$$;

revoke all on function public.can_edit(uuid) from public;
grant execute on function public.can_edit(uuid) to anon, authenticated;

-- 修改：只有拿着同一个设备令牌的人，才能改自己交的那几条
drop policy if exists "author can edit own homework" on public.submissions;
create policy "author can edit own homework"
  on public.submissions
  for update
  to anon
  using (public.can_edit(id))
  with check (
    public.can_edit(id)
    and status in ('verified', 'withdrawn')          -- 不能自己改成「精选」
  );

-- 读取：所有人都能看已发布的作业；作者永远能读到自己的那条（包括已撤回的）。
--
-- 「作者也能读到自己的」这一条不只是方便：PostgREST 在改动之后会把新行读回来，
-- 而 PostgreSQL 会拿 SELECT 策略去校验这个新行。如果不放开这一条，
-- 把作业改成 withdrawn 会因为「新行不在 SELECT 策略里」而整体失败
-- （报 new row violates row-level security policy，但数据其实没变）。
drop policy if exists "anyone can read published answers" on public.submissions;
create policy "anyone can read published answers"
  on public.submissions
  for select
  to anon, authenticated
  using (
    status in ('verified', 'peer', 'alternative')
    or public.can_edit(id)
  );

-- ---------------------------- 3. 读得到什么、写得到什么 ----------------
--
-- 读取用「列级授权」：edit_token、grade、author_note 不给 anon，
-- 所以网站只请求白名单里的列，别人也读不到同学的学号和等级。
--
-- 写入必须给「表级」权限 —— PostgREST 只认表级的 INSERT，
-- 列级授权它不认（会报 permission denied for table）。
-- 表级写入带来的风险由下面两个东西兜住：
--   · 行级权限：只能改自己那台设备交的，且不能自己改状态成「精选」；
--   · 触发器：写入时把老师的字段清掉，改作业时不许碰老师的字段。

revoke all on public.submissions from anon;

grant select (
  id, created_at, updated_at, exercise, author, title, body, tags,
  attachments, status, helpful, feedback, revision
) on public.submissions to anon;

grant insert on public.submissions to anon;
grant update on public.submissions to anon;

-- 不让同学伪造批语、等级，也不让他们改动设备令牌和提交时间。
-- 注意：这个函数**不能**写成 security definer，
-- 否则 current_user 永远是函数属主，就分辨不出是谁在写入了。
create or replace function public.protect_submission_fields()
returns trigger
language plpgsql
as $$
begin
  -- 老师那边（控制台 Table Editor、批改工具、SQL Editor）不受限制
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.grade      := '';
    new.feedback   := '';
    new.graded_at  := null;
    new.helpful    := 0;
    new.revision   := 1;
  else
    new.grade      := old.grade;
    new.feedback   := old.feedback;
    new.graded_at  := old.graded_at;
    new.helpful    := old.helpful;
    new.edit_token := old.edit_token;
    new.created_at := old.created_at;
    if new.revision is null or new.revision <= old.revision then
      new.revision := old.revision + 1;
    end if;
  end if;
  return new;
end $$;

grant execute on function public.protect_submission_fields() to anon, authenticated;

drop trigger if exists protect_submission_fields on public.submissions;
create trigger protect_submission_fields
  before insert or update on public.submissions
  for each row execute function public.protect_submission_fields();

-- --------------------------------------- 4. 同学取回自己的作业 ---------
--
-- 学生手上只有令牌，读不到 grade / author_note 这些列。
-- 这个函数替他读回来：令牌对得上才返回，而且是连私密字段一起给。

create or replace function public.my_submissions(p_token text)
returns table (
  id uuid, created_at timestamptz, updated_at timestamptz,
  exercise text, author text, author_note text, title text, body text,
  tags text[], attachments jsonb, status text,
  grade text, feedback text, graded_at timestamptz, revision integer
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.created_at, s.updated_at,
         s.exercise, s.author, s.author_note, s.title, s.body,
         s.tags, s.attachments, s.status,
         s.grade, s.feedback, s.graded_at, s.revision
  from public.submissions s
  where char_length(p_token) >= 16
    and s.edit_token = p_token
  order by s.created_at desc
$$;

revoke all on function public.my_submissions(text) from public;
grant execute on function public.my_submissions(text) to anon, authenticated;

-- ------------------------------------------------------- 5. 文件存储 ---

insert into storage.buckets (id, name, public)
values ('answer-uploads', 'answer-uploads', true)
on conflict (id) do update set public = true;

drop policy if exists "anon can upload homework files" on storage.objects;
create policy "anon can upload homework files"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'answer-uploads');

drop policy if exists "anyone can read homework files" on storage.objects;
create policy "anyone can read homework files"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'answer-uploads');

-- ===========================================================================
--  老师的操作（批改、撤下、删除）用 service_role，它会绕过 RLS。
--  可以在 Supabase 控制台的 Table Editor 里改，或者在本机跑：
--      node scripts/grade-ui.mjs     # 批改界面
--      node scripts/moderate.mjs     # 命令行
-- ===========================================================================
