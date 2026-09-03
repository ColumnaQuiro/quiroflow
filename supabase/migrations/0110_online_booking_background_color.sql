-- Lets the public booking page's outer background be tuned to match whatever
-- site embeds it (e.g. a marketing site's cream tone), on top of the
-- existing primary/secondary accent colors.
alter table accounts add column online_booking_background_color text;
