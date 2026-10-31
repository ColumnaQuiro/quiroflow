# QuiroFlow listing screenshots (G2, Capterra, GetApp, Software Advice)

Seven 1600×1000 PNGs of the real app in Spanish, captured from a local stack
seeded with the fictional **Clínica Demo**. Every patient, practitioner, phone
number, ID and address is invented, and no production data was used. The
posture photos are drawn mannequins, not photos of a person.

| File | Title | Description |
| --- | --- | --- |
| `01-calendar-rooms-practitioners.png` | Multi-room clinic calendar | See the whole clinic's day at a glance: one column per treatment room, colour-coded by visit type, with each practitioner's schedule, confirmation status, who is in the room right now and today's takings in the sidebar. |
| `02-patient-record-care-plan.png` | Patient record with care-plan tracking | Each patient's record shows their treatment plan period by period. When a patient falls behind and has nothing booked, QuiroFlow flags it before they drop out, and booking the remaining visits takes one click. |
| `03-whatsapp-inbox.png` | Shared WhatsApp inbox | Automatic WhatsApp reminders and patient replies arrive in one shared inbox. Reception can reschedule in the same conversation while the patient's next visit, last visit and balance stay on screen. |
| `04-session-package-billing.png` | Session packages (bonos) and invoices | Sell multi-session packages and track every session used against them. Each payment gets a numbered invoice in a signed chain, ready for VeriFactu, and the patient's balance always adds up. |
| `05-posture-analysis.png` | Posture analysis with reference points | Take posture photos and reference points are placed automatically on the ear, shoulder, hip, knee and ankle. Forward head posture, effective head weight and shoulder and pelvic tilt are measured, and two assessments can be compared side by side to show progress. |
| `06-retention-report.png` | Retention and care-plan reports | Find out whether patients come back: return rates by month of first visit, rebooking rates by practitioner, and a list of unfinished care plans you can follow up with a single WhatsApp. |
| `07-patient-app.png` | Patient app | Patients see their next visit, confirm attendance, check how many package sessions they have left and message the clinic from their phone. |

The VeriFactu QR code only prints on invoices from a production chain. The
demo clinic is on a test chain, so no invoice in these images shows one.

## Regenerating

1. Start a local Supabase stack. If another worktree is already running one,
   give this one its own `project_id` and ports in `supabase/config.toml`, and
   don't commit that change.
2. Seed the demo clinic. A rerun replaces the previous one:

   ```bash
   NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 npx jiti scripts/seed-demo-clinic.ts > /tmp/demo-clinic.json
   ```

   Pass the stack's API URL, plus `NUXT_PUBLIC_SUPABASE_KEY` and
   `NUXT_SUPABASE_SECRET_KEY` if they differ from the CLI defaults. The JSON
   it prints holds the logins (all with the password `Demo1234!`) and the ids
   of the featured patients. `DEMO_DAY=YYYY-MM-DD` picks the demo's "today";
   by default it is the most recent weekday.
3. Run `nuxt dev --no-fork` against the same stack. Export the three
   `NUXT_*SUPABASE*` variables, because the repo `.env` points at production.
4. Capture the images with `capture.mjs`. It needs `playwright-core` and a
   local Chrome, and freezes the browser clock at 10:18 on `DEMO_DAY`:

   ```bash
   npm i --no-save playwright-core
   BASE_URL=http://localhost:3000 node marketing/screenshots/capture.mjs marketing/screenshots /tmp/demo-clinic.json
   ```

Check every image for real-looking personal data before you upload it.
