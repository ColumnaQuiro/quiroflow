# Recall automation: recovering lapsed patients

Analysis and plan, 18 Oct 2026. Numbers are from the production database for
Columnaquiro; the product findings apply to every clinic.

## 1. Where we are

**Who is lapsed.** Active patients, not do-not-contact, not minors, not
dismissed or snoozed in Recalls, with at least one attended visit and nothing
booked ahead:

| Last visit | Patients | 1 visit only | 2–4 visits | 5+ visits | Has phone |
|---|---:|---:|---:|---:|---:|
| under 90 days | 104 | 34 | 28 | 42 | 104 |
| 90–179 days | 128 | 52 | 28 | 48 | 126 |
| 180–364 days | 153 | 54 | 28 | 71 | 149 |
| 1–2 years | 303 | 100 | 78 | 125 | 298 |
| over 2 years | 213 | 111 | 53 | 49 | 210 |
| **Total** | **901** | 351 | 215 | 335 | 887 |

For scale: 534 patients attended 3,070 visits in the last 12 months and paid
€159,910, so a visit is worth about €52 and a returning patient about €300 a
year. The clinic already sells a "Reactivación paciente" visit at €60 and a
free "Chequeo Postural".

**Three things about the data that shape the plan:**

1. **Nobody has WhatsApp marketing consent recorded.** `marketing_channels`
   contains `whatsapp` for zero patients; only 9 of the 901 have any channel at
   all. Consent was never carried over from PracticeHub. The shipped starter
   automation "Pacientes que no vuelven" is a *marketing* rule that branches on
   that field, so at this clinic it would enrol 9 people and WhatsApp none of
   them. Any recall automation here has to run as **continuity of care**
   (non-marketing, like "Planes sin terminar"). Under LSSI art. 21.2 that is
   the "existing customer, similar service" basis: lawful without prior opt-in
   as long as the patient can refuse at any time. The messages do not
   advertise an opt-out word, so refusing has to work through the normal
   reply: a "No, gracias" (or BAJA/STOP) must set do-not-contact, and today
   **nothing does that automatically**; it has to exist before the first send.
2. **Care plans are not the lever here.** Only 1 patient has an unfinished care
   plan with nothing booked, because plans are not recorded for most patients.
   "Planes sin terminar" is right for clinics that use plans; this clinic needs
   a recall keyed on time since last visit and number of visits.
3. **About 11% of phone numbers no longer answer on WhatsApp.** In September's
   send 11 of 100 failed. Failures and blocks count against the phone number's
   quality rating, so the automation must pace itself and fall back to email
   instead of hammering a 2-year-old list in one morning.

**Baseline: what already worked.** On 3 Sep the clinic bulk-sent
`recall_oferta_vuelta_cole_2026` to 100 lapsed patients from Recalls:

| Sent | Failed | Replied within 7 days | Booked afterwards | Attended |
|---:|---:|---:|---:|---:|
| 100 | 11 | 14 | 16 | 14 |

16% booked, for roughly €6 in message fees. That is the number to beat and the
reason to automate: it was one manual afternoon, and the 90–365-day band alone
has 281 people in it today.

Other signals from 120 days of sends: templates with quick-reply buttons get
replies (appointment reminder 72%, the September recall 14%); long sales copy
does not (`getting_back_mantenimientos`, the template Recalls currently
defaults to, was sent 6 times, 3 failed, 0 replies). Only 56 of the 901 prefer
a language other than Spanish, mostly in the 1-year-plus bands.

## 2. What the product already has

- **Recalls page**: queue, snooze, dismiss, priority, call log, one-to-one and
  bulk WhatsApp (`components/BulkSendWhatsAppModal.vue`), CSV export.
- **Automation engine** with a `segment` trigger: a weekly schedule, filters
  (`last_visit_before_days`, `has_future_appointment`, `tag_contains`,
  `balance`, `clinic_ids`, …), `reentry_days`, `one_at_a_time`, quiet hours
  (10:00–20:00 Mon–Sat), `wait_until` on `appointment.booked` or
  `whatsapp.replied` with a timeout branch, `tag`, `notify`, email steps.
  Enrolment runs from the lead-sequence cron every 15 minutes
  (`enrolDueSegments` in `server/utils/automationEngine.ts`).
- **Starter flows** in `utils/automationTemplates.ts`: "Recuperar tras la
  visita" (2 days after a visit with nothing booked), "Pacientes que no
  vuelven" (180 days, marketing), "Planes sin terminar".
- **Variables**: `first_name`, `booking_link` (→ `/book/columnaquiro`),
  `clinic_name`, `clinic_phone`, and a template-language match
  (`match_patient_language`). At Columnaquiro only "Primera visita" and
  "Oferta Primera visita" are bookable online, so a booking link is useless
  to a returning patient: recall templates use quick replies instead of URL
  buttons.
- **Replies** land in the Inbox, raise `whatsapp.replied` (ends waits, exits
  runs), and the Receptionist add-on answers them: it reads free times from
  the calendar, offers them, and can book (`server/utils/receptionistBooking.ts`).
  "Sí, por favor" / "Mañanas" / "Tardes" are therefore handled end to end
  without the desk, the same way lead replies are today.
- **Measurement**: Reports › Retention "win-back" card reads `contact_log`
  rows not tied to an appointment and counts bookings within 30 days; the
  automation sender writes those rows, so automated recalls will show up there.
  Per-rule and per-step stats exist on the Automations screen.

## 3. What is missing (the product work)

Small, one PR, all in the engine and catalog:

1. **Segment filters for bands and visit counts.** Today only "last visit more
   than N days ago" and "exactly N visits" exist, so the 90–180 band cannot be
   told from the 2-year-plus band and first-visit-only patients cannot be told
   from long-term ones. Add `last_visit_within_days`, `min_visits`,
   `max_visits`, and `no_whatsapp_sent_days` (nothing sent to them by anyone,
   manual or automated, in N days). `ruleFiltersMatch` and `segmentAudience`
   both need them; the segment e2e spec checks the two agree.
2. **Daily send cap on a segment** (`segment.daily_limit`, e.g. 40). Enrolment
   today creates every matching run at once. With a cap it takes the most
   recently lapsed first and leaves the rest for the next day. This protects
   the number's quality rating and keeps the Inbox answerable.
3. **Decline handling.** In the WhatsApp webhook: the "No, gracias" quick
   reply, or a bare `BAJA`/`STOP`, sets `do_not_contact`, tags the patient,
   and exits any running sequence. The templates do not mention it; it is the
   safety net behind the legal basis above and Meta's own policy.
4. **Two variables**: `practitioner_first_name` (the patient's default
   practitioner, so the message comes from "Léa", not from "the clinic") and
   `last_visit_month` ("desde junio"). Both come from data the sender already
   loads.
5. **Recall purpose** on the message row (`purpose = 'recall'`) when a rule of
   these templates sends, so Reports › Communications groups them, and the
   Recalls page shows "Automation sent on …" as the last contact.
6. **Three new starter flows** replacing "Pacientes que no vuelven" (below),
   non-marketing, with the opt-out explained in the activation dialog.
7. **Quick reply "Más adelante" → snooze 60 days.** Optional but cheap: the
   webhook already sees button titles; mapping that one to
   `recall_snoozed_until` keeps the patient out of every recall for two months
   without anyone touching Recalls.

Not needed: a new cron (segments ride the existing tick), new tables, or app
changes.

## 4. The rules to switch on

All four are non-marketing segments on a weekly schedule, `one_at_a_time`,
quiet hours on, daily cap 40, sent from the patient's practitioner. The
filters exclude anyone messaged by anyone in the last 30 days and anyone with
an open balance dispute if the clinic wants (`balance: debit` is available).

**R0 · Prevention, "Recuperar tras la visita"** (existing starter, switch on).
Trigger: appointment completed; 2 days later, if nothing booked, WhatsApp
`recall_sin_proxima_cita`; if not booked in 7 days, notify the practitioner.
30 patients a month currently leave without a next appointment.

**R1 · "Segunda visita pendiente"** — 1 visit, last visit 21–120 days ago.
Weekly, reentry 180 days. WhatsApp `recall_segunda_visita` → wait 5 days for
booking or reply → on timeout, email (same message, with the booking button)
→ wait 7 days → notify practitioner "llamar". Expect the lowest conversion;
keep the cap low (15/day) and watch the opt-outs.

**R2 · "Mantenimiento: 3 meses sin venir"** — 2+ visits, last visit 90–180
days. Weekly, reentry 120 days. WhatsApp `recall_mantenimiento_3m` → wait
5 days → on timeout `recall_seguimiento` → wait 7 days → on timeout: if 5+
visits, notify practitioner to call; else tag `recall · sin respuesta`.
This is the core rule: 76 people today, and the band every month refills from.

**R3 · "Reactivación: 6 a 12 meses"** — 2+ visits, last visit 180–365 days.
Weekly, reentry 180 days. WhatsApp `recall_reactivacion_6m` (quick replies; the receptionist answers
with free times) → wait 7 days → on timeout email →
wait 14 days → tag. 99 people today.

**R4 · "Más de un año"** — any visits, 365–730 days. One-off campaign
(`schedule.kind: once`), cap 30/day so it takes ~10 days. WhatsApp
`recall_un_ano` → wait 10 days → on timeout email. 303 people. Do not add the
2-year-plus band (213) to any automation: too many dead numbers for the
quality rating; send them a single email campaign instead, or leave them.

**Replies.** Everything comes into the Inbox as usual. "Sí, por favor",
"Mañanas" and "Tardes" are booking requests the Receptionist add-on answers
with free times and books, exactly as it does for leads; "Más adelante"
snoozes; "No, gracias" opts out. A reply ends the sequence, so nobody gets
the follow-up after answering.

## 5. WhatsApp templates (Meta-ready)

Category MARKETING for all of them. Meta reclassifies anything with a
"come back" intent as marketing even if submitted as utility, and a template
that says what it is gets approved first time. Spanish, informal, first person
from the practitioner, one question, quick-reply buttons instead of walls of
text or booking links, under 600 characters. Variable examples are what Meta
asks for at submission.

### recall_sin_proxima_cita (R0 · 2 days after a visit)
Body:
```
Hola {{1}}, soy {{2}} 👋 Vi que saliste el otro día sin la siguiente cita apuntada. Para que el ajuste se asiente conviene no dejar pasar mucho: ¿te busco un hueco para la semana que viene?
```
Buttons: QUICK_REPLY «Sí, por favor» · QUICK_REPLY «Más adelante»
Examples: `["Laura","Léa"]`. Variables: `first_name`, `practitioner_first_name`.
"Sí, por favor" is answered by the receptionist with free times, as for leads.

### recall_segunda_visita (R1 · one visit, 3 weeks to 4 months)
Body:
```
Hola {{1}}, soy {{2}} de Columnaquiro 😊 Después de tu primera visita me quedé con ganas de saber cómo sigues. Tu valoración y el informe siguen aquí, y en la segunda visita te los explico y vemos juntos si tiene sentido seguir, sin compromiso. ¿Te viene mejor por la mañana o por la tarde?
```
Buttons: QUICK_REPLY «Mañanas» · QUICK_REPLY «Tardes» · QUICK_REPLY «No, gracias»
Examples: `["Laura","Léa"]`.

### recall_mantenimiento_3m (R2 · core)
Body:
```
Hola {{1}}, soy {{2}} 👋 Han pasado unos meses desde tu último ajuste y toca revisar cómo va esa columna. Los resultados se mantienen mucho mejor con un ajuste de vez en cuando que esperando a que vuelva la molestia. ¿Te busco un hueco? 👇
```
Buttons: QUICK_REPLY «Mañanas» · QUICK_REPLY «Tardes» · QUICK_REPLY «Más adelante»
Examples: `["Laura","Léa"]`.

English version (`recall_mantenimiento_3m`, language `en`, same name so the
language match picks it):
```
Hi {{1}}, it's {{2}} 👋 It's been a few months since your last adjustment and it's time to check in on that spine. Results hold up much better with an adjustment every so often than by waiting for the discomfort to come back. Shall I find you a slot? 👇
```
Buttons: «Mornings» · «Afternoons» · «Later on».

### recall_seguimiento (R2 follow-up, 5 days later, only if no reply)
Body:
```
Hola {{1}}, te escribí hace unos días por si querías retomar tus ajustes. Si ahora no es buen momento, sin problema: dime «Más adelante» y te escribo en un par de meses 😊
```
Buttons: QUICK_REPLY «Sí, buscar hueco» · QUICK_REPLY «Más adelante» · QUICK_REPLY «No, gracias»
Examples: `["Laura"]`.

### recall_reactivacion_6m (R3 · 6 to 12 months)
Body:
```
Hola {{1}}, soy {{2}} de Columnaquiro 👋 Hace más de seis meses que no te vemos y quería saber cómo estás. Si notas que la espalda vuelve a pedir atención, tenemos la visita de reactivación con chequeo postural incluido: vemos cómo estás ahora y retomamos desde ahí. Dime si te viene mejor por la mañana o por la tarde y te paso los huecos libres 😊
```
Buttons: QUICK_REPLY «Mañanas» · QUICK_REPLY «Tardes» · QUICK_REPLY «Prefiero que me llaméis»
Examples: `["Laura","Léa"]`.

### recall_un_ano (R4 · 1 to 2 years, one-off)
Body:
```
Hola {{1}}, soy {{2}} de Columnaquiro 👋 Ha pasado más de un año desde tu última visita y nos gustaría volver a verte. Si te apetece una puesta a punto, dime qué te viene mejor y te paso los huecos libres, o simplemente cuéntame cómo estás 😊
```
Buttons: QUICK_REPLY «Sí, buscar hueco» · QUICK_REPLY «Más adelante» · QUICK_REPLY «No, gracias»
Examples: `["Laura","Léa"]`.

Submission notes: keep `{{2}}` filled with the practitioner's first name,
never empty (Meta rejects empty
parameters and the sender should fall back to the clinic name). Approval is
usually minutes, sometimes 24 h; the automation save dialog already refuses
to activate a rule whose template is still pending.

## 6. Rollout

1. **Week 1 — PR with section 3** (filters, cap, opt-out keyword, variables,
   purpose, starter flows). Preflight + build, CI, merge. The seven templates (six Spanish, one English) were submitted to
   Meta on 18 Oct and are PENDING; check their status in Settings › WhatsApp
   or the automation's template picker.
2. **Week 1, no code — switch on R0** with the existing starter and
   `recall_sin_proxima_cita` as soon as it is approved. It is the cheapest win
   and risk-free (recent patients, warm numbers).
3. **Week 2 — release**, then switch on R2 first (76 people, best odds), R3
   two days later. Set `recall_mantenimiento_3m` as the Recalls page default
   template (Settings › WhatsApp) in place of `getting_back_mantenimientos`. Read the Inbox daily for the first week; the desk needs to
   answer "Mañanas/Tardes" within the hour for the rate to hold.
4. **Week 3 — R1 and R4** once the quality rating has stayed green through R2
   and R3. R4 is a one-off; if its failure rate passes 15% on day one, lower
   the cap or stop and switch that band to email.
5. **Monthly**: Retention › win-back card (contacts → bookings within 30 days)
   per rule, opt-outs (`do_not_contact` set by a decline reply), Meta quality rating.

**Expected results, using September's 16% as the only real data point:** the
90–365 band (281 people) at 12–16% is 35–45 returning patients in the first
month, worth €1,800–2,300 on the first visit alone and far more if they stay
on maintenance. R4 at half that rate adds 20–25. Message cost at Meta's Spain
marketing rate (third-party rate cards put it at €0.05–0.06 per message;
confirm on Meta's own rate card) is under €60 for everything in this plan.

## 7. Decisions for you

- Legal footing, decided: recall as continuity of care, no opt-out sentence
  in the messages; a "No, gracias" reply sets do-not-contact. Collecting
  marketing consent first (a consent form to 900 people) is the alternative
  if you ever want promotional sends to this list.
- Whether R4 (1–2 years) runs at all, and whether 2-year-plus gets one email.
- Whether the Receptionist add-on answers recall replies on its own from day
  one (it does for leads) or drafts for the desk during R2/R3 week one.
