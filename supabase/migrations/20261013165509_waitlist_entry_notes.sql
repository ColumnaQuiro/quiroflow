-- When a waiting patient can come ("solo viernes por la tarde"). The AI
-- receptionist puts someone on the list when no free time suits them, and
-- what does suit them is the whole point of the entry: without it the front
-- desk would offer the next freed slot to someone who can only come on a
-- different day.
alter table public.waitlist_entries add column if not exists notes text;

comment on column public.waitlist_entries.notes is
  'When they can come, in words; written by the AI receptionist or staff';
comment on column public.waitlist_entries.source is
  'patient = added by the patient themselves (join_my_waitlist); receptionist = by the AI receptionist; null = staff or anything older';
