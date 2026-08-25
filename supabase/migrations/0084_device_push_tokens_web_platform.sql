-- Browser push (composables/useWebPush.ts) registers into the same table
-- mobile already uses, so server/utils/pushNotifications.ts sends to both
-- with no changes -- it just needed 'web' as a valid platform value.
alter table device_push_tokens drop constraint device_push_tokens_platform_check;
alter table device_push_tokens add constraint device_push_tokens_platform_check
  check (platform = any (array['ios', 'android', 'web']));
