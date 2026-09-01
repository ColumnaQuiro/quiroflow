-- Backs "delete my account" for staff (Apple App Store Guideline 5.1.1(v)).
-- Not a hard delete: team_members.user_id cascades on delete straight
-- through cash_shifts.opened_by and cash_movements.team_member_id (both
-- not-null, on delete cascade), so deleting a staff member who ever opened
-- a cash shift would silently destroy real financial audit records.
-- Deactivation instead: login is revoked immediately (auth.admin bans the
-- user), and this flag hides them from active-staff lists everywhere,
-- while every historical record (appointments, cash movements, audit
-- logs) keeps referencing the same row untouched.
alter table team_members add column deleted_at timestamptz;
