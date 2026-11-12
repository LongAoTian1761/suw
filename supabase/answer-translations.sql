begin;
create table if not exists public.answer_translations (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  source_revision integer not null,
  target_lang text check (target_lang in ('en', 'zh')),
  body text,
  check ((target_lang is null and body is null) or
    (target_lang is not null and body is not null and length(btrim(body)) between 1 and 60000))
);
alter table public.answer_translations enable row level security;
revoke all on public.answer_translations from anon, authenticated;
grant select on public.answer_translations to anon, authenticated;
grant select, insert, update on public.answer_translations to service_role;
drop policy if exists "read current published translations" on public.answer_translations;
create policy "read current published translations" on public.answer_translations
  for select to anon, authenticated using (target_lang is not null and exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.revision = source_revision
      and s.status in ('verified', 'peer', 'alternative')
  ));

create or replace function public.pending_answer_translations(p_limit integer default 10)
returns table (id uuid, revision integer, body text)
language sql stable security invoker set search_path = ''
as $$
  select s.id, s.revision, s.body
  from public.submissions s
  where s.status in ('verified', 'peer', 'alternative')
    and s.body ~ '[^[:space:]]'
    and char_length(s.body) <= 1200
    and not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(s.attachments) = 'array' then s.attachments else '[]'::jsonb end
      ) as a(file)
      where coalesce(a.file->>'name', '') ~* '\.pdf$'
        or coalesce(a.file->>'url', '') ~* '\.pdf($|[?#])'
        or coalesce(a.file->>'type', '') = 'application/pdf'
    )
    and not exists (select 1 from public.answer_translations t
      where t.submission_id = s.id and t.source_revision = s.revision)
  order by s.updated_at desc nulls last, s.id
  limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;
revoke all on function public.pending_answer_translations(integer) from public, anon, authenticated;
grant execute on function public.pending_answer_translations(integer) to service_role;
commit;
