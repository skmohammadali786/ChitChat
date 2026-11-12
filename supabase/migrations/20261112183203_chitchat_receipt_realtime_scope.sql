alter table public.message_receipts
  add column conversation_id uuid references public.conversations(id) on delete cascade;

update public.message_receipts r
set conversation_id=m.conversation_id
from public.messages m
where m.id=r.message_id and r.conversation_id is null;

alter table public.message_receipts
  alter column conversation_id set not null;

create index message_receipts_conversation_recipient_idx
  on public.message_receipts(conversation_id,recipient_id,read_at);

drop policy if exists message_receipts_select_conversation_member on public.message_receipts;
create policy message_receipts_select_conversation_member
  on public.message_receipts for select to authenticated
  using (recipient_id=(select auth.uid()) or private.is_conversation_member(conversation_id));

create or replace function private.create_message_receipts()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.message_receipts(message_id,conversation_id,recipient_id)
  select new.id,new.conversation_id,cm.user_id
  from public.conversation_members cm
  where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id
  on conflict(message_id,recipient_id) do nothing;
  return new;
end;
$$;
revoke all on function private.create_message_receipts() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['conversations','conversation_members','message_reactions'] loop
    if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
       and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end
$$;
