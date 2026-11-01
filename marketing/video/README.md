# QuiroFlow listing video (G2, Capterra, GetApp, Software Advice)

`quiroflow-demo.mp4` is a 1920×1080 H.264 film of the real app in Spanish, with
no sound and an English caption under each scene. `poster.png` is its
1920×1080 thumbnail. Both were recorded from a local stack seeded with the
fictional **Clínica Demo**: every patient, practitioner, phone number, ID and
address is invented, and no production data was used. The posture photos are
drawn mannequins, not photos of a person.

## Scenes

| # | What happens | Caption |
| --- | --- | --- |
| – | Title card | *Practice management for physio, chiro, osteo and podiatry clinics* |
| 1 | The day across Sala 1–3, one practitioner each. Reception clicks the free 17:00 in Sala 2, finds the patient, picks Fisioterapia and Álex, sees "17:00–17:45 está libre en Sala 2 con Álex" and books it. | One calendar for every room and practitioner — book a free slot in seconds |
| 2 | Marta's record: her care plan is behind ("Con retraso", red periods, nothing booked). "Reservar las 7 visitas que faltan" opens the calendar booking for her; reception picks Monday 17:30, the panel repeats along the plan ("Seguir plan de cuidados — 7 sesiones restantes"), and her record then shows the next visit. | Spot patients falling behind their care plan, and book every visit left in one go |
| 3 | The inbox: Irene answers her WhatsApp reminder with "SÍ"; Carmen asks to move her visit and the AI receptionist offers two times and moves it. | WhatsApp reminders, confirmations and AI receptionist replies in one inbox |
| 4 | Nuria buys the 10-session bono she asked about in the inbox, by card. The bono shows as paid with ten sessions left, and its factura is in the patient's facturas with its number and concept. | Sell a session package and its factura is issued on the spot |
| 5 | Daniel's posture: the four measurements with their change, then the two assessments side by side, from the right, the front and the back, with the reference points on each figure. | Posture photos with reference points, compared before and after |
| 6 | The patient app (Alba): her next visit, the sessions left on her bono, then her appointments, where she confirms next week's visit. | Patients see their next visit, confirm it and track their sessions in the app |
| – | End card | *quiroflow.com* |

Upload `quiroflow-demo.mp4` to YouTube and paste its link into each listing;
`poster.png` is the custom thumbnail.

## Re-recording

The video is cut from a screen recording, not edited by hand, so re-recording
is the way to change it -- after a UI change, or to alter a scene in
`record.mjs`.

1. Start a local Supabase stack. If another worktree is already running one,
   give this one its own `project_id` and ports in `supabase/config.toml`, and
   don't commit that change. Make sure it has every migration.
2. Seed the demo clinic. **Reseed before every recording**: the script books,
   sells and confirms things as it goes, and a second run on the same data
   finds the slots taken.

   ```bash
   NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 npx jiti scripts/seed-demo-clinic.ts > /tmp/demo-clinic.json
   ```

   Pass the stack's API URL, plus `NUXT_PUBLIC_SUPABASE_KEY` and
   `NUXT_SUPABASE_SECRET_KEY` if they differ from the CLI defaults. Leave
   `DEMO_DAY` at its default (the most recent weekday): the scenes book
   17:00 that day and from 17:30 the following Monday, which the seed leaves
   free.
3. Run `nuxt dev --no-fork` against the same stack, exporting the three
   `NUXT_*SUPABASE*` variables (the repo `.env` points at production). A
   production build (`npm run build` then `node .output/server/index.mjs`)
   works too and loads faster.
4. Record. It needs `playwright-core`, an ffmpeg with libx264 and a local
   Chrome (`CHROME_PATH` and `FFMPEG` override where they are; without
   `FFMPEG` it uses `ffmpeg` on the PATH, else `ffmpeg-static`):

   ```bash
   npm i --no-save playwright-core ffmpeg-static
   BASE_URL=http://localhost:3000 node marketing/video/record.mjs /tmp/demo-clinic.json marketing/video
   ```

   It takes three to five minutes and prints each scene's length.

How it works: both browser sessions sign in and visit every page once first,
unfilmed, so a dev server has compiled them. Chrome's screencast then films the
desktop at 1366×768 CSS px drawn at 1600×900 device pixels, and the patient app
at 414×896 drawn at 2×, so the text is sharp rather than upscaled. Only the
stretches between `keep()` and `cut()` reach the film, so page loads, spinners
and skeletons are cut out. The cursor and click ripples are drawn into the page
by the script, since a headless browser has none. ffmpeg then puts each scene
on the brand gradient with rounded corners and its caption underneath,
crossfades the scenes and adds the title and end cards. The captions and cards
are drawn in the app's own typeface, Instrument Sans, from `public/fonts`.

Before uploading a new recording, watch it through, or pull a frame every two
seconds and look at them:

```bash
mkdir -p /tmp/frames && ffmpeg -i marketing/video/quiroflow-demo.mp4 -vf fps=0.5 /tmp/frames/%03d.png
```

Check for a spinner or skeleton, an error toast, an English string in the UI,
and anything that looks like a real person's data.
