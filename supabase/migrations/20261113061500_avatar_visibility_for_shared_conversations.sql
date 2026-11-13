-- Allow profile avatar ciphertext to be fetched by a user who shares an
-- active conversation with the avatar owner, even when that owner has disabled
-- public username discovery. Blocked relationships remain denied.

create or replace function private.can_view_profile_avatar(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select auth.uid() is not null
    and target_user_id is not null
    and (
      target_user_id=auth.uid()
      or (
        not private.is_blocked_between(target_user_id)
        and (
          exists (
            select 1
            from public.profiles p
            where p.id=target_user_id and p.discoverable=true
          )
          or exists (
            select 1
            from public.conversation_members mine
            join public.conversation_members peer
              on peer.conversation_id=mine.conversation_id
            join public.conversations c
              on c.id=mine.conversation_id
            where mine.user_id=auth.uid()
              and peer.user_id=target_user_id
              and c.kind in ('direct','group')
          )
        )
      )
    );
$$;
revoke all on function private.can_view_profile_avatar(uuid) from public,anon,authenticated;
grant execute on function private.can_view_profile_avatar(uuid) to authenticated;

drop policy if exists media_objects_select_authorized on public.media_objects;
create policy media_objects_select_authorized
  on public.media_objects
  for select
  to authenticated
  using (
    owner_id=(select auth.uid())
    or (conversation_id is not null and private.is_conversation_member(conversation_id))
    or (media_kind='avatar' and private.can_view_profile_avatar(owner_id))
  );
