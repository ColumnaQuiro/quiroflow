<script setup lang="ts">
// Informes: the web's /reports on the phone. Números (the dashboard's
// figures, pages/numbers.vue) first, then the clinic's own report pages,
// then every standard report the web lists, each its own screen under the
// same path as on the web.
//
// The list is the web's (pages/reports/index.vue), repeated here rather
// than shared: its icons and the third-parties entry (a billing page on the
// web, a report screen here) differ. A report added there needs its screen
// and its line here too.
//
// Who sees which is the web's rule for the same path (useReportAccess), so
// "only their own figures" never sees the clinic-wide ones, and Commissions
// is for owners.
definePageMeta({ layout: 'practitioner', keepalive: true })
defineOptions({ name: 'StaffReportsPage' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const supabase = useSupabaseClient()
const { context, loading, canOpen, hasReports, reportsPractitionerId } = useReportAccess()

// Números for whoever the dashboard is for (dashboard_scope), as on My Day.
const seesNumbers = computed(() => {
  const c = context.value
  if (!c) return false
  if (c.isOwner) return true
  const s = c.permissions.dashboard_scope
  return s === 'all' || s === 'own'
})

interface Item { to: string; access?: string; label: string; description: string }
const allGroups = computed<{ label: string; items: Item[] }[]>(() => [
  {
    label: t('Operations', 'Operaciones'),
    items: [
      { to: '/reports/scheduled-reminders', label: t('Scheduled Reminders', 'Recordatorios programados'), description: t('WhatsApp delivery and who has confirmed, is pending, or wants to reschedule.', 'Entrega de WhatsApp y quién ha confirmado, está pendiente o quiere reprogramar.') },
      { to: '/reports/communications', label: t('Communications', 'Comunicaciones'), description: t('Every message sent to patients and leads, with its status.', 'Todos los mensajes enviados a pacientes y leads, con su estado.') },
      { to: '/reports/upcoming-visits', label: t('Upcoming Visits', 'Próximas visitas'), description: t('How appointments are spread across the month.', 'Cómo se reparten las citas a lo largo del mes.') },
      { to: '/reports/patient-flow', label: t('Patient Flow', 'Flujo de pacientes'), description: t('Waiting, running late, and how long sessions last.', 'Esperas, retrasos y cuánto dura cada consulta.') },
      { to: '/reports/appointment-distribution', label: t('Appointment Distribution', 'Distribución de citas'), description: t('Which shift and time of day performs best.', 'Qué turno y hora del día rinde mejor.') },
    ],
  },
  {
    label: t('Growth & Performance', 'Crecimiento y rendimiento'),
    items: [
      { to: '/reports/retention', label: t('Retention', 'Retención'), description: t('Who comes back, rebooking, and unfinished care plans.', 'Quién vuelve, reservas y planes sin terminar.') },
      { to: '/reports/recalls', label: t('Recalls', 'Recuperaciones'), description: t('What the recall automations brought back.', 'Lo que han recuperado las automatizaciones.') },
      { to: '/reports/referrals', label: t('Referrals', 'Recomendaciones'), description: t('Who brought whom, who came, and rewards still to give.', 'Quién trajo a quién, quién vino y detalles pendientes.') },
      { to: '/reports/statistics', label: t('Statistics', 'Estadísticas'), description: t('First visits, reports, revisions, PVA, conversion.', 'Primeras visitas, informes, revisiones, PVA, conversión.') },
      { to: '/reports/income-performance', label: t('Income Performance', 'Rendimiento de ingresos'), description: t('Practitioners and months side by side.', 'Profesionales y meses uno junto a otro.') },
    ],
  },
  {
    label: t('Financial', 'Financiero'),
    items: [
      { to: '/reports/income', label: t('Income & Payments', 'Ingresos y pagos'), description: t('Revenue by period, payment method, practitioner, visit type.', 'Ingresos por periodo, método de pago, profesional y tipo de visita.') },
      { to: '/reports/commissions', label: t('Commissions', 'Comisiones'), description: t('What each person earned this month from their pay plan.', 'Lo que ha generado cada persona en el mes según su retribución.') },
      { to: '/reports/daily-transactions', label: t('Daily Transactions', 'Transacciones del día'), description: t('Every payment and refund on a day, for the cash count.', 'Todos los pagos y reembolsos de un día, para el cuadre de caja.') },
      { to: '/reports/debtors', label: t('Debtors', 'Deudores'), description: t('Bonos with money still owed on them.', 'Bonos con dinero pendiente.') },
      { to: '/reports/third-parties', access: '/billing/third-parties', label: t('Third parties owed', 'Pendiente de terceros'), description: t('What insurers, mutuas and companies owe.', 'Lo que deben aseguradoras, mutuas y empresas.') },
      { to: '/reports/memberships', label: t('Memberships', 'Membresías'), description: t('Active memberships, monthly revenue, failed payments.', 'Membresías activas, ingresos mensuales y pagos fallidos.') },
    ],
  },
  {
    label: t('Data', 'Datos'),
    items: [
      { to: '/reports/facturas', label: t('Issued facturas', 'Facturas emitidas'), description: t('Every factura issued in a period, with base, IVA and total.', 'Todas las facturas emitidas en un periodo, con base, IVA y total.') },
      { to: '/reports/gestoria', label: t('Accountant', 'Gestoría'), description: t('Facturas and IVA for the quarter, in one download.', 'Facturas e IVA del trimestre, en una descarga.') },
      { to: '/reports/data-exports', label: t('Data Exports', 'Exportaciones de datos'), description: t('Patients missing an email, phone, or a consent form.', 'Pacientes sin correo, teléfono o consentimiento.') },
    ],
  },
])
const groups = computed(() => allGroups.value.map((g) => ({ ...g, items: g.items.filter((i) => canOpen(i.access ?? i.to)) })).filter((g) => g.items.length > 0))

// The clinic's own report pages, as the web lists them (RLS hides someone
// else's private one). Read on the phone; made and edited on the web.
interface PageRow { id: string; name: string; visibility: string; updated_at: string }
const pages = ref<PageRow[]>([])
const pagesLoading = ref(true)
const pagesLoaded = ref(false)
async function loadPages() {
  const { data } = await supabase.from('report_pages').select('id, name, visibility, updated_at').order('updated_at', { ascending: false })
  pages.value = (data ?? []) as PageRow[]
  pagesLoading.value = false
  pagesLoaded.value = true
}
watch(hasReports, (on) => { if (on && !pagesLoaded.value) loadPages() }, { immediate: true })
useKeptAlive({ onReturn: () => { if (hasReports.value) loadPages() } })
const locale = computed(() => t('en-GB', 'es-ES'))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page">
    <AppPageHeader :title="t('Reports', 'Informes')">
      <StaffHelpButton v-if="context" />
    </AppPageHeader>

    <AppSkeletonList v-if="loading" :rows="6" class="min-h-0 flex-1" />
    <p v-else-if="!context || !hasReports" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="reports-none">
      {{ t("Your role doesn't include reports.", 'Tu rol no incluye los informes.') }}
    </p>
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-[max(1.5rem,calc((100%_-_52rem)/2))]" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)" data-cy="reports-hub">
      <p v-if="reportsPractitionerId" class="mb-3 rounded-card border border-line bg-surface-subtle px-3.5 py-3 text-[13px] leading-snug text-ink-700" data-cy="reports-own-only-note">
        {{ t('Your role shows you only your own figures: your appointments, your takings and your patients.', 'Tu rol te enseña solo tus datos: tus citas, tus cobros y tus pacientes.') }}
      </p>

      <NuxtLink v-if="seesNumbers" to="/numbers" class="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 shadow-card active:bg-surface-subtle" data-cy="reports-numbers">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2.5 13.5h11M4 11V8M7 11V4.5M10 11V6.5M13 11V3" /></svg>
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="text-[15px] font-semibold text-ink-900">{{ t('Numbers', 'Números') }}</span>
          <span class="text-[12.5px] text-ink-muted">{{ t('Income, visits and retention at a glance', 'Ingresos, visitas y retención de un vistazo') }}</span>
        </span>
        <AppChevron dir="right" :size="16" class="text-ink-faint" />
      </NuxtLink>

      <section v-if="pagesLoading || pages.length" class="mt-5" data-cy="report-pages">
        <h2 class="mb-1.5 px-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Report pages', 'Páginas de informes') }}</h2>
        <ul class="rounded-card border border-line bg-surface px-4 shadow-card">
          <template v-if="pagesLoading">
            <li v-for="i in 2" :key="i" class="flex flex-col gap-1.5 border-b border-line-divider py-3.5 last:border-b-0">
              <UiSkeleton class="h-3.5 w-1/2 rounded-ctlSm" />
              <UiSkeleton class="h-3 w-1/3 rounded-ctlSm" />
            </li>
          </template>
          <ReportRow
            v-for="p in pages"
            v-else
            :key="p.id"
            :to="`/reports/pages/${p.id}`"
            :title="p.name"
            :subtitle="`${p.visibility === 'clinic' ? t('Whole clinic', 'Toda la clínica') : t('Only me', 'Solo yo')} · ${t('edited', 'editada el')} ${new Date(p.updated_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`"
            data-cy="report-page-card"
          />
        </ul>
      </section>

      <section v-for="g in groups" :key="g.label" class="mt-5">
        <h2 class="mb-1.5 px-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ g.label }}</h2>
        <ul class="rounded-card border border-line bg-surface px-4 shadow-card">
          <ReportRow v-for="i in g.items" :key="i.to" :to="i.to" :title="i.label" :subtitle="i.description" :data-cy="`report-link-${i.to.split('/').pop()}`" />
        </ul>
      </section>
    </div>
  </div>
</template>
