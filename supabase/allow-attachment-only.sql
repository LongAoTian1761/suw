-- Apply in the existing project's Supabase SQL Editor before publishing the form.
begin;
alter table public.submissions
  drop constraint if exists submissions_body_len,
  drop constraint if exists submissions_has_content,
  add constraint submissions_body_len check (char_length(body) <= 20000),
  add constraint submissions_has_content check (
    body ~ '[^[:space:]]' or
    (jsonb_typeof(attachments) = 'array' and attachments <> '[]'::jsonb)
  ) not valid;
commit;
