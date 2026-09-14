-- Pin search_path on the functions the Growth migrations added.
--
-- Flagged by Supabase's own linter (0011_function_search_path_mutable) right
-- after those migrations reached production. All five are SECURITY INVOKER
-- triggers, so they run as the caller and the exposure is small -- but a
-- mutable search_path means an unqualified name inside the body resolves
-- against whatever the caller's search_path happens to be, and "small" is not
-- a reason to leave a resolution rule up to the caller.
--
-- record_review_request_opened is deliberately absent: it is the one
-- SECURITY DEFINER function of the set, and it already sets search_path in
-- the migration that created it, which is where it matters most.

alter function lead_stage_rank(text) set search_path = public;
alter function leads_touch_updated_at() set search_path = public;
alter function leads_sync_ai_handling() set search_path = public;
alter function receptionist_config_touch_updated_at() set search_path = public;
alter function reviews_touch_updated_at() set search_path = public;
