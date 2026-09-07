-- Adds the two allowances the pricing rework left open: WhatsApp
-- conversations and file storage. These are the only two things in the
-- product with a real marginal cost -- Meta bills per conversation, and
-- patient files sit in storage forever and only grow -- so a plan that
-- ignores them is structurally exposed to one clinic running a large
-- campaign or uploading a decade of imaging.
--
-- They are ceilings, not meters. Set far enough out that a normal clinic
-- never learns they exist: the live account, three practitioners with eight
-- years of history, uses 283 conversations a month and 6.86 GB, against a
-- Practice allowance of 1,500 and 100 GB. Nothing here blocks anything --
-- WhatsApp is how these clinics reach patients, and cutting that off over a
-- billing threshold would be a worse product than eating the overage. The
-- numbers exist so usage is visible and an overage conversation is possible.
--
--   Solo      500 conversations   25 GB
--   Practice  1,500               100 GB
--   Clinic    3,000               250 GB
--
-- "Conversation" deliberately does not mean "message". Meta bills per 24-hour
-- session per recipient, so counting raw sends would overstate what we
-- actually pay: the live account sent 369 outbound messages this month across
-- 283 recipient-days. Recipient-per-day is the closest proxy the schema can
-- express, and it errs the same way Meta's own model does.

alter table plans
  add column if not exists included_whatsapp_conversations integer,
  add column if not exists included_storage_gb integer;

comment on column plans.included_whatsapp_conversations is
  'Outbound WhatsApp conversations (distinct recipient per day) included per calendar month. Null means no ceiling.';
comment on column plans.included_storage_gb is
  'Patient file storage included, in GB. Null means no ceiling.';

update plans set included_whatsapp_conversations = 500,   included_storage_gb = 25  where id = 'starter';
update plans set included_whatsapp_conversations = 1500,  included_storage_gb = 100 where id = 'pro';
update plans set included_whatsapp_conversations = 3000,  included_storage_gb = 250 where id = 'clinic';

-- Usage for one account, as the account itself sees it.
--
-- SECURITY DEFINER with an explicit membership check rather than a plain view:
-- patient_files carries per-patient RLS, so an 'own'-scope practitioner
-- reading a view would get a storage figure filtered to their own caseload
-- and think the clinic was using a fraction of what it is. Usage is an
-- account-level fact and has to read the same for everyone entitled to see
-- it, so the function bypasses RLS and gates on membership instead.
create or replace function public.account_usage(target_account_id uuid)
returns table(whatsapp_conversations_mtd bigint, storage_bytes bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (
      select count(*)
      from (
        select distinct
          coalesce(w.phone_number, w.patient_id::text) as recipient,
          (w.created_at at time zone 'Europe/Madrid')::date as day
        from whatsapp_messages w
        where w.account_id = target_account_id
          and w.direction = 'outbound'
          and w.created_at >= date_trunc('month', now() at time zone 'Europe/Madrid')
          and coalesce(w.phone_number, w.patient_id::text) is not null
      ) conversations
    ) as whatsapp_conversations_mtd,
    coalesce((select sum(pf.size_bytes) from patient_files pf where pf.account_id = target_account_id), 0)::bigint as storage_bytes
  where is_account_member(target_account_id);
$function$;

revoke all on function public.account_usage(uuid) from public;
grant execute on function public.account_usage(uuid) to authenticated;
