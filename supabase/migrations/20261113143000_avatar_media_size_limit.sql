-- Avatar objects have a stricter maximum than conversation attachments.
alter table public.media_objects
  add constraint media_objects_avatar_size_limit
  check (media_kind <> 'avatar' or size_bytes <= 8388608)
  not valid;
alter table public.media_objects
  validate constraint media_objects_avatar_size_limit;
