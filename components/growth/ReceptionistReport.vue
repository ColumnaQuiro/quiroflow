<script setup lang="ts">
import { cancellationReasonLabel } from '~/utils/cancellationReason'
import { REPORT_WEEK_CHOICES, shareOf, type ReceptionistReport, type ReportActor } from '~/utils/receptionistReport'

// Growth > AI receptionist > Report: how its conversations are going, to
// decide what to adjust. Week by week what it did; how much of the clinic's
// cancelling and moving it now handles; whether the people who cancelled --
// first visits above all -- came back; why they cancelled; and what offering
// earlier first visits has done. Loaded only when the tab is opened.
const t = useT()

const weeks = ref<number>(8)
const { data: report, pending, error, refresh } = useLazyFetch<ReceptionistReport>('/api/growth/receptionist/report', { query: { weeks }, server: false })

const nf = (n: number) => n.toLocaleString('es-ES')

function weekLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const totals = computed(() => {
  const r = report.value
  if (!r) return null
  const sum = (k: keyof ReceptionistReport['weeks'][number]) => r.weeks.reduce((acc, w) => acc + Number(w[k] ?? 0), 0)
  return { sent: sum('sent'), drafted: sum('drafted'), booked: sum('booked'), moved: sum('moved'), cancelled: sum('cancelled'), handedOver: sum('handedOver') }
})

const ACTORS: ReportActor[] = ['receptionist', 'staff', 'other']
function actorLabel(who: ReportActor) {
  return who === 'receptionist' ? t('AI receptionist', 'Recepcionista IA') : who === 'staff' ? t('The team', 'El equipo') : t('Patient or automatic', 'Paciente o automático')
}

const share = computed(() => {
  const r = report.value
  if (!r) return null
  const cancelled = ACTORS.reduce((acc, who) => acc + (r.cancellations[who]?.total ?? 0), 0)
  const moved = ACTORS.reduce((acc, who) => acc + (r.moves[who]?.total ?? 0), 0)
  const mine = { cancelled: r.cancellations.receptionist?.total ?? 0, moved: r.moves.receptionist?.total ?? 0, earlier: r.moves.receptionist?.earlier ?? 0 }
  return { cancelled, moved, mine }
})

const cancelRows = computed(() => {
  const r = report.value
  if (!r) return []
  return ACTORS.filter((who) => r.cancellations[who]?.total).map((who) => ({ who, ...r.cancellations[who]! }))
})

const offers = computed(() => report.value?.earlierOffers ?? null)

// Whether a visit is kept: of the cancellations that left nothing booked,
// how many got a new time; of the times it offered, how many were taken; of
// the "Cambiar cita" taps, how many ended moved rather than cancelled.
const kept = computed(() => {
  const r = report.value
  if (!r) return null
  const mine = r.cancellations.receptionist
  return {
    alone: mine?.alone ?? 0,
    rebooked: mine?.rebooked ?? 0,
    teamAlone: r.cancellations.staff?.alone ?? 0,
    teamRebooked: r.cancellations.staff?.rebooked ?? 0,
    offers: r.timeOffers ?? null,
    taps: r.changeTaps ?? null,
    followUps: r.followUps ?? null,
  }
})

function pct(n: number, total: number) {
  const p = shareOf(n, total)
  return p === null ? '' : `${p} %`
}
</script>

<template>
  <div class="flex flex-col gap-4" data-test="receptionist-report">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-[12px] text-ink-muted">
        {{ t('Read from the notes it leaves in each conversation and the activity log, so it shows only what the threads show.', 'Sale de las notas que deja en cada conversación y del registro de actividad: solo muestra lo que se ve en las conversaciones.') }}
      </p>
      <div class="flex items-center gap-1" role="group" :aria-label="t('Period', 'Periodo')">
        <button
          v-for="n in REPORT_WEEK_CHOICES"
          :key="n"
          type="button"
          class="h-7 touch:h-11 rounded-ctl border px-2.5 text-[11.5px] font-semibold"
          :class="weeks === n ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-muted hover:border-line-controlHover'"
          :aria-pressed="weeks === n"
          :data-test="`report-weeks-${n}`"
          @click="weeks = n"
        >{{ t(`${n} weeks`, `${n} semanas`) }}</button>
      </div>
    </div>

    <GrowthPageNotice v-if="error" kind="error" :title="t('The report could not be read.', 'No se ha podido leer el informe.')" @retry="refresh" />

    <div v-else-if="pending && !report" class="grid animate-pulse gap-4" aria-hidden="true">
      <div class="h-56 rounded-card border border-line bg-surface shadow-card" />
      <div class="h-40 rounded-card border border-line bg-surface shadow-card" />
    </div>

    <template v-else-if="report && totals && share">
      <!-- Week by week -->
      <GrowthSettingCard :title="t('Week by week', 'Semana a semana')">
        <p v-if="!report.weeks.length" class="text-[12px] text-ink-muted" data-test="report-empty">
          {{ t('Nothing in this period yet.', 'Nada en este periodo todavía.') }}
        </p>
        <div v-else class="-mx-1 overflow-x-auto">
          <table class="w-full min-w-[560px] text-[12px]" data-test="report-weeks">
            <thead>
              <tr class="text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">
                <th class="px-1 py-1.5 font-[640]">{{ t('Week of', 'Semana del') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Replies', 'Respuestas') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Chats', 'Conversaciones') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Booked', 'Reservas') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Moved', 'Cambios') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Cancelled', 'Cancelaciones') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('To a person', 'A una persona') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider tabular-nums">
              <tr v-for="w in report.weeks" :key="w.week">
                <td class="px-1 py-1.5 text-ink-700">{{ weekLabel(w.week) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-900">{{ nf(w.sent) }}<span v-if="w.drafted" class="text-ink-faint"> +{{ nf(w.drafted) }}</span></td>
                <td class="px-1 py-1.5 text-right text-ink-700">{{ nf(w.conversations) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-700">{{ nf(w.booked) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-700">{{ nf(w.moved) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-700">{{ nf(w.cancelled) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-700">{{ nf(w.handedOver) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t border-line font-semibold text-ink-900 tabular-nums">
                <td class="px-1 py-1.5">{{ t('Total', 'Total') }}</td>
                <td class="px-1 py-1.5 text-right">{{ nf(totals.sent) }}<span v-if="totals.drafted" class="font-normal text-ink-faint"> +{{ nf(totals.drafted) }}</span></td>
                <td class="px-1 py-1.5" />
                <td class="px-1 py-1.5 text-right">{{ nf(totals.booked) }}</td>
                <td class="px-1 py-1.5 text-right">{{ nf(totals.moved) }}</td>
                <td class="px-1 py-1.5 text-right">{{ nf(totals.cancelled) }}</td>
                <td class="px-1 py-1.5 text-right">{{ nf(totals.handedOver) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="text-[11px] text-ink-faint">{{ t('Replies: sent on its own, + drafts left for a person.', 'Respuestas: enviadas por ella sola, + borradores que dejó para una persona.') }}</p>
      </GrowthSettingCard>

      <!-- How much of the clinic's cancelling and moving it handles -->
      <GrowthSettingCard :title="t('Cancellations and changes', 'Cancelaciones y cambios')">
        <dl class="grid gap-2 sm:grid-cols-3" data-test="report-share">
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(share.mine.cancelled) }} <span class="text-[12px] font-normal text-ink-muted">{{ t('of', 'de') }} {{ nf(share.cancelled) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t('cancellations it handled', 'cancelaciones que gestionó') }} {{ pct(share.mine.cancelled, share.cancelled) }}</dt>
          </div>
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(share.mine.moved) }} <span class="text-[12px] font-normal text-ink-muted">{{ t('of', 'de') }} {{ nf(share.moved) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t('visits moved', 'citas cambiadas') }} {{ pct(share.mine.moved, share.moved) }}</dt>
          </div>
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(share.mine.earlier) }} <span class="text-[12px] font-normal text-ink-muted">{{ t('of', 'de') }} {{ nf(share.mine.moved) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t('of its moves were to an earlier time', 'de sus cambios fueron a antes') }}</dt>
          </div>
        </dl>
        <p class="text-[11px] text-ink-faint">{{ t("The team's changes include its own adjustments, not only what patients asked for.", 'Los cambios del equipo incluyen sus propios ajustes, no solo lo que pidieron los pacientes.') }}</p>

        <div class="-mx-1 overflow-x-auto border-t border-line-divider pt-2.5">
          <table class="w-full min-w-[480px] text-[12px]" data-test="report-came-back">
            <thead>
              <tr class="text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">
                <th class="px-1 py-1.5 font-[640]">{{ t('Cancelled by', 'Canceló') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Visits', 'Citas') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Came back', 'Volvieron') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('First visits', 'Primeras visitas') }}</th>
                <th class="px-1 py-1.5 text-right font-[640]">{{ t('Came back', 'Volvieron') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider tabular-nums">
              <tr v-for="row in cancelRows" :key="row.who">
                <td class="px-1 py-1.5 text-ink-700">{{ actorLabel(row.who) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-900">{{ nf(row.total) }}</td>
                <td class="px-1 py-1.5 text-right text-ink-700">{{ nf(row.cameBack) }} <span class="text-ink-faint">{{ pct(row.cameBack, row.total) }}</span></td>
                <td class="px-1 py-1.5 text-right text-ink-900">{{ nf(row.firstVisits) }}</td>
                <td class="px-1 py-1.5 text-right" :class="row.firstVisits && row.firstVisitsCameBack / row.firstVisits < 0.25 ? 'text-warning-text' : 'text-ink-700'">{{ nf(row.firstVisitsCameBack) }} <span class="text-ink-faint">{{ pct(row.firstVisitsCameBack, row.firstVisits) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-ink-faint">{{ t('"Came back": has a visit after the cancellation, booked or had.', '«Volvieron»: tienen una cita posterior a la cancelación, reservada o ya hecha.') }}</p>
      </GrowthSettingCard>

      <!-- Whether the visit is kept -->
      <GrowthSettingCard v-if="kept && (kept.alone || kept.offers?.total || kept.taps?.total)" :title="t('Keeping the visit', 'Citas que no se pierden')">
        <dl class="grid gap-2 sm:grid-cols-3" data-test="report-kept">
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(kept.rebooked) }} <span class="text-[12px] font-normal text-ink-muted">{{ t('of', 'de') }} {{ nf(kept.alone) }} {{ pct(kept.rebooked, kept.alone) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t('cancellations it handled that got a new visit within 14 days', 'cancelaciones que gestionó y tuvieron cita nueva en 14 días') }}<template v-if="kept.teamAlone"> · {{ t(`the team: ${nf(kept.teamRebooked)} of ${nf(kept.teamAlone)}`, `el equipo: ${nf(kept.teamRebooked)} de ${nf(kept.teamAlone)}`) }}</template></dt>
          </div>
          <div v-if="kept.offers" class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(kept.offers.bookedByReceptionist + kept.offers.bookedByTeam) }} <span class="text-[12px] font-normal text-ink-muted">{{ t('of', 'de') }} {{ nf(kept.offers.total) }} {{ pct(kept.offers.bookedByReceptionist + kept.offers.bookedByTeam, kept.offers.total) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t(`times it offered that ended booked · ${nf(kept.offers.bookedByReceptionist)} by it, ${nf(kept.offers.bookedByTeam)} by the team`, `veces que ofreció horas y acabó en cita · ${nf(kept.offers.bookedByReceptionist)} ella, ${nf(kept.offers.bookedByTeam)} el equipo`) }}</dt>
          </div>
          <div v-if="kept.taps" class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(kept.taps.moved) }} <span class="text-[12px] font-normal text-ink-muted">{{ t('of', 'de') }} {{ nf(kept.taps.total) }} {{ pct(kept.taps.moved, kept.taps.total) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t(`"Cambiar cita" taps that ended with a new time · ${nf(kept.taps.cancelledOnly)} ended cancelled`, `«Cambiar cita» que acabó con hora nueva · ${nf(kept.taps.cancelledOnly)} acabaron canceladas`) }}</dt>
          </div>
        </dl>
        <p class="text-[11px] text-ink-faint">
          {{ t('Cancellations counted are those that left no other visit booked. Offers and taps are looked at three days later, so the last three days are not in yet.', 'Se cuentan las cancelaciones que dejaron a la persona sin ninguna cita. Las horas ofrecidas y los «Cambiar cita» se miran tres días después, así que los tres últimos días aún no cuentan.') }}
          <template v-if="kept.followUps && (kept.followUps.nudgesSent || kept.followUps.agreedSent || kept.followUps.agreedTasks)">
            {{ t(`It wrote first ${nf(kept.followUps.nudgesSent)} times after an offer nobody answered and ${nf(kept.followUps.agreedSent)} on a day it had agreed; ${nf(kept.followUps.agreedTasks)} more went to the team to write.`, `Escribió ella primero ${nf(kept.followUps.nudgesSent)} veces tras ofrecer horas sin respuesta y ${nf(kept.followUps.agreedSent)} el día que había quedado; ${nf(kept.followUps.agreedTasks)} más pasaron al equipo para escribir.`) }}
          </template>
        </p>
      </GrowthSettingCard>

      <!-- Why -->
      <GrowthSettingCard :title="t('Why they cancelled', 'Por qué cancelaron')">
        <ul class="flex flex-col divide-y divide-line-divider text-[12px]" data-test="report-reasons">
          <li v-for="r in report.reasons" :key="r.reason ?? 'none'" class="flex items-baseline gap-2 py-1.5">
            <span class="flex-1" :class="r.reason ? 'text-ink-900' : 'text-ink-muted'">{{ cancellationReasonLabel(r.reason, t) }}</span>
            <span class="tabular-nums text-ink-900">{{ nf(r.total) }}</span>
            <span class="w-40 text-right tabular-nums text-ink-faint">{{ t(`${nf(r.firstVisits)} first visits`, `${nf(r.firstVisits)} primeras visitas`) }}</span>
          </li>
        </ul>
        <p class="text-[11px] text-ink-faint">
          {{ t('The receptionist asks why when a first visit is cancelled, with the reasons to tap. "Will book later" puts the person in Recalls.', 'La recepcionista pregunta el motivo cuando se cancela una primera visita, con opciones para elegir. «Reservará más adelante» pone a la persona en Recuperaciones.') }}
        </p>
      </GrowthSettingCard>

      <!-- Earlier first visits: only at a clinic that offers them -->
      <GrowthSettingCard v-if="offers && offers.enrolled" :title="t('Earlier first visits', 'Adelantar primeras visitas')">
        <dl class="grid gap-2 sm:grid-cols-4" data-test="report-earlier">
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(offers.offered) }}</dd>
            <dt class="text-[11px] text-ink-muted">{{ t(`people offered (${nf(offers.messages)} messages)`, `personas a las que se ofreció (${nf(offers.messages)} mensajes)`) }}</dt>
          </div>
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(offers.accepted) }} <span class="text-[12px] font-normal text-ink-muted">{{ pct(offers.accepted, offers.offered) }}</span></dd>
            <dt class="text-[11px] text-ink-muted">{{ t('accepted', 'aceptaron') }}<template v-if="offers.daysEarlierAccepted !== null"> · {{ t(`${offers.daysEarlierAccepted} days earlier on average`, `${offers.daysEarlierAccepted} días antes de media`) }}</template></dt>
          </div>
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(offers.acceptedAttended) }}</dd>
            <dt class="text-[11px] text-ink-muted">{{ t(`came to the earlier visit · ${nf(offers.acceptedCancelled)} cancelled it`, `vinieron a la cita adelantada · ${nf(offers.acceptedCancelled)} la cancelaron`) }}</dt>
          </div>
          <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
            <dd class="text-[16px] font-semibold text-ink-900">{{ nf(offers.declined) }}</dd>
            <dt class="text-[11px] text-ink-muted">{{ t('preferred to keep theirs', 'prefirieron quedarse con la suya') }}</dt>
          </div>
        </dl>
        <p class="text-[11px] text-ink-faint">
          {{ t(`${nf(offers.enrolled)} first visits on the list; ${nf(offers.open)} still waiting for a time to free up, ${nf(offers.closedCancelled)} cancelled before taking one.`, `${nf(offers.enrolled)} primeras visitas en la lista; ${nf(offers.open)} siguen esperando a que se libere un hueco y ${nf(offers.closedCancelled)} se cancelaron antes de aceptar ninguno.`) }}
        </p>
      </GrowthSettingCard>
    </template>
  </div>
</template>
