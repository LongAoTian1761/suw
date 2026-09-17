-- ===========================================================================
--  小补丁：让「撤回」生效
--
--  只改一条规则，很短，直接粘进 SQL Editor 跑一次即可。
--
--  背景：PostgREST 改完数据后会把新行读回来，PostgreSQL 会拿「谁能看见
--  这一行」的规则去校验这个新行。已撤回的作业按设计不该出现在公开列表里，
--  于是新行校验不过，整个更新被回滚 —— 表现就是撤回报 401、数据却没变。
--
--  修法：作者永远能读到自己的那条（包括已撤回的），别人照旧只看得到已发布的。
--  公开页面上已撤回的作业依然不显示（客户端的查询本来就带状态过滤）。
--
--  跑完之后，新版 schema.sql 里也是这一条，不会冲突。
-- ===========================================================================

drop policy if exists "anyone can read published answers" on public.submissions;

create policy "anyone can read published answers"
  on public.submissions
  for select
  to anon, authenticated
  using (
    status in ('verified', 'peer', 'alternative')
    or public.can_edit(id)
  );
