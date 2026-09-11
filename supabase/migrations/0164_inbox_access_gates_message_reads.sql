-- Make the Inbox role setting actually withhold the Inbox.
--
-- inbox_access has existed since the Inbox was built. It hides the sidebar
-- link, it gates every Inbox server route, and 0122/0123/0124 gated the
-- labels, archives and saved replies that were added later. The one thing
-- it never gated was the messages themselves: both message tables carried a
-- single FOR ALL policy checking only is_account_member.
--
-- So the setting worked everywhere except where it mattered. Checked
-- against the live account as a practitioner whose role has inbox_access
-- false: has_permission(...,'inbox_access') returned false, saved_replies
-- and whatsapp_labels returned 0 rows -- and whatsapp_messages returned
-- 1,438. Every patient conversation with the clinic was readable by any
-- signed-in team member through the API, whatever their role said.
--
-- Reads are now gated. Writes are deliberately NOT, because several
-- legitimate senders run under a staff session that has no reason to hold
-- inbox_access:
--
--   /api/whatsapp/send            requires recalls_access, not inbox_access
--   /api/automations/fire         requireTeamMember, fired by whoever is at
--                                 the desk when a patient checks in
--   runAutomationActions          logs each send it makes
--
-- Requiring inbox_access to INSERT would stop a practitioner's check-in
-- from firing its automation. Confidentiality here is about who can READ
-- other people's conversations, so that is exactly what is restricted.
--
-- The service-role policy is untouched: the WhatsApp webhook writes inbound
-- messages with no user at all.

-- ---------------------------------------------------------------------
-- whatsapp_messages
-- ---------------------------------------------------------------------

drop policy if exists "staff manage whatsapp_messages" on whatsapp_messages;

create policy "staff read whatsapp_messages" on whatsapp_messages
for select using (
  is_account_member(account_id)
  and has_permission(account_id, 'inbox_access')
);

create policy "staff insert whatsapp_messages" on whatsapp_messages
for insert with check (is_account_member(account_id));

create policy "staff update whatsapp_messages" on whatsapp_messages
for update using (is_account_member(account_id))
with check (is_account_member(account_id));

-- Deleting a conversation is an Inbox action (pages/inbox.vue's bulk
-- delete) and nothing else does it, so unlike insert/update this one does
-- take the permission.
create policy "staff delete whatsapp_messages" on whatsapp_messages
for delete using (
  is_account_member(account_id)
  and has_permission(account_id, 'inbox_access')
);

-- ---------------------------------------------------------------------
-- patient_app_messages
-- ---------------------------------------------------------------------

-- Same split. The two patient-side policies (0085) are untouched: a patient
-- reading and writing their own thread has nothing to do with a staff
-- role's inbox_access.
drop policy if exists "staff manage patient_app_messages" on patient_app_messages;

create policy "staff read patient_app_messages" on patient_app_messages
for select using (
  is_account_member(account_id)
  and has_permission(account_id, 'inbox_access')
);

create policy "staff insert patient_app_messages" on patient_app_messages
for insert with check (is_account_member(account_id));

create policy "staff update patient_app_messages" on patient_app_messages
for update using (is_account_member(account_id))
with check (is_account_member(account_id));

create policy "staff delete patient_app_messages" on patient_app_messages
for delete using (
  is_account_member(account_id)
  and has_permission(account_id, 'inbox_access')
);
