-- The clinic's look for emails built from blocks (utils/emailDesign.ts):
-- buttons and links colour, button text, headings, text, background, card,
-- and a web-safe typeface. One jsonb rather than seven columns, because the
-- keys belong to the email compiler and it validates every value before one
-- reaches a style attribute (resolveEmailTheme); a key it does not know is
-- ignored rather than rendered.
--
-- Null until the clinic sets it: every email then uses QuiroFlow's plain
-- card, as automation emails always have.
--
-- The column name falls under accounts_settings_permission's 'email\_%'
-- rule, so changing it needs settings_access plus communication_config --
-- the same as the clinic's other email settings -- with no change to that
-- function. accounts is already audited (fn_audit_log), so the change is
-- recorded with the rest of the row.

alter table public.accounts add column if not exists email_branding jsonb;

comment on column public.accounts.email_branding is
  'Email builder branding: { brandColor, buttonTextColor, headingColor, textColor, backgroundColor, contentColor: "#RRGGBB", font: system|helvetica|georgia|verdana }. Null = QuiroFlow defaults.';
