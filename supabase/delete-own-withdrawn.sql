begin;
create or replace function public.delete_own_withdrawn_submission(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.submissions
  where id = p_id
    and status = 'withdrawn'
    and char_length(public.current_edit_token()) >= 16
    and edit_token = public.current_edit_token();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
revoke all on function public.delete_own_withdrawn_submission(uuid) from public;
grant execute on function public.delete_own_withdrawn_submission(uuid) to anon, authenticated;
commit;
