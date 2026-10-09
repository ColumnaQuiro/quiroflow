<script setup lang="ts">
import { newBlockId, normaliseBlocks, pageTemplates } from '~/utils/reportBlocks'

const ICONS = {
  bell: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  squares:
    'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  chartBar:
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  trendingUp: 'M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  billing: 'M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  exclamationTriangle:
    'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  badgeCheck:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  arrowDownTray: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
}
const t = useT()
const allGroups = computed(() => [
  {
    label: t('Operations', 'Operaciones'),
    items: [
      { to: '/reports/scheduled-reminders', label: t('Scheduled Reminders', 'Recordatorios programados'), description: t('WhatsApp delivery status and who has confirmed, is pending, or wants to reschedule.', 'Estado de entrega de WhatsApp y quién ha confirmado, está pendiente o quiere reprogramar.'), icon: ICONS.bell },
      { to: '/reports/communications', label: t('Communications', 'Comunicaciones'), description: t('Every WhatsApp, email, app message and push sent to patients and leads, with its status.', 'Todos los WhatsApp, correos, mensajes en la app y push enviados a pacientes y leads, con su estado.'), icon: ICONS.bell },
      { to: '/reports/upcoming-visits', label: t('Upcoming Visits', 'Próximas visitas'), description: t('How appointments are distributed across the month.', 'Cómo se distribuyen las citas a lo largo del mes.'), icon: ICONS.calendar },
      { to: '/reports/patient-flow', label: t('Patient Flow', 'Flujo de pacientes'), description: t('How long patients wait, how late the clinic runs, and how long sessions last.', 'Cuánto esperan los pacientes, cuánto retraso lleva la clínica y cuánto dura cada consulta.'), icon: ICONS.squares },
      { to: '/reports/appointment-distribution', label: t('Appointment Distribution', 'Distribución de citas'), description: t('Which shift/time of day performs best, by volume and completion.', 'Qué turno/hora del día rinde mejor, por volumen y finalización.'), icon: ICONS.squares },
    ],
  },
  {
    label: t('Growth & Performance', 'Crecimiento y rendimiento'),
    items: [
      { to: '/reports/statistics', label: t('Statistics', 'Estadísticas'), description: t('First visits, reports, revisions, PVA, conversion, and retention.', 'Primeras visitas, informes, revisiones, PVA, conversión y retención.'), icon: ICONS.chartBar },
      { to: '/reports/income-performance', label: t('Income Performance', 'Rendimiento de ingresos'), description: t('Compare practitioners and months side by side, with growth curves.', 'Compara profesionales y meses uno junto a otro, con curvas de crecimiento.'), icon: ICONS.trendingUp },
    ],
  },
  {
    label: t('Financial', 'Financiero'),
    items: [
      { to: '/reports/income', label: t('Income & Payments', 'Ingresos y pagos'), description: t('Revenue by day/week/month/year, payment method, practitioner, visit type.', 'Ingresos por día/semana/mes/año, método de pago, profesional y tipo de visita.'), icon: ICONS.billing },
      { to: '/reports/daily-transactions', label: t('Daily Transactions', 'Transacciones del día'), description: t('Every payment and refund on a given day, for end-of-day cash reconciliation.', 'Todos los pagos y reembolsos de un día, para el cuadre de caja.'), icon: ICONS.calendar },
      { to: '/reports/debtors', label: t('Debtors', 'Deudores'), description: t('Package/bono purchases with no paid receipt, and how much is outstanding.', 'Compras de bonos/paquetes sin recibo pagado y cuánto queda pendiente.'), icon: ICONS.exclamationTriangle },
      { to: '/reports/memberships', label: t('Memberships', 'Membresías'), description: t('Active membership count, monthly revenue, and failed payments.', 'Número de membresías activas, ingresos mensuales y pagos fallidos.'), icon: ICONS.badgeCheck },
    ],
  },
  {
    label: t('Data', 'Datos'),
    items: [
      { to: '/reports/data-exports', label: t('Data Exports', 'Exportaciones de datos'), description: t('Patients missing an email, phone, or a consent/data protection form.', 'Pacientes sin correo, teléfono o formulario de consentimiento/protección de datos.'), icon: ICONS.arrowDownTray },
    ],
  },
])

// Only the reports this person can open. With "only their own figures" the
// clinic-wide ones are refused by the route guard (CLINIC_WIDE_REPORTS), so
// offering them here would only lead to "you don't have access".
const store = useAccountStore()
const { reportsPractitionerId } = useOwnScope()
const groups = computed(() =>
  allGroups.value.map((g) => ({ ...g, items: g.items.filter((i) => isRouteAllowed(store, i.to)) })).filter((g) => g.items.length > 0),
)

// ---- Report pages -----------------------------------------------------------
// The clinic's own dashboards, above the standard reports. Row-level security
// already hides someone else's private page.
interface PageCard {
  id: string
  name: string
  visibility: string
  blocks: unknown
  updated_at: string
  created_by: string | null
}
const supabase = useSupabaseClient()
const router = useRouter()
const toast = useToast()
const pages = ref<PageCard[]>([])
const pagesLoading = ref(true)
const memberNames = ref(new Map<string, string>())
onMounted(async () => {
  const [{ data }, { data: members }] = await Promise.all([
    supabase.from('report_pages').select('id, name, visibility, blocks, updated_at, created_by').order('updated_at', { ascending: false }),
    supabase.from('team_members').select('id, full_name'),
  ])
  pages.value = (data ?? []) as PageCard[]
  memberNames.value = new Map((members ?? []).map((m) => [m.id, m.full_name]))
  pagesLoading.value = false
})
const cards = computed(() =>
  pages.value.map((p) => {
    const blocks = normaliseBlocks(p.blocks)
    const who = p.visibility === 'clinic' ? t('Whole clinic', 'Toda la clínica') : t('Only me', 'Solo yo')
    const by = p.created_by ? memberNames.value.get(p.created_by) : null
    const when = new Date(p.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return {
      ...p,
      blocks,
      meta: [who, by, t(`edited ${when}`, `editada el ${when}`)].filter(Boolean).join(' · '),
      summary: blocks.slice(0, 4).map((b) => b.title).join(', '),
    }
  }),
)

const templates = computed(() => pageTemplates(t))
const creating = ref(false)
const newName = ref('')
const newVisibility = ref<'clinic' | 'private'>('clinic')
const newTemplate = ref<string>('')
watch(newTemplate, (key) => {
  const tpl = templates.value.find((x) => x.key === key)
  if (tpl && (!newName.value || templates.value.some((x) => x.name === newName.value))) newName.value = tpl.name
})
function openCreate(templateKey = '') {
  newTemplate.value = templateKey
  newName.value = templates.value.find((x) => x.key === templateKey)?.name ?? ''
  newVisibility.value = 'clinic'
  creating.value = true
}
async function createPage() {
  const name = newName.value.trim()
  if (!name || !store.accountId) return
  const tpl = templates.value.find((x) => x.key === newTemplate.value)
  const { data, error } = await supabase
    .from('report_pages')
    .insert({
      account_id: store.accountId,
      name,
      visibility: newVisibility.value,
      blocks: (tpl?.blocks ?? []).map((b) => ({ ...b, id: newBlockId() })) as never,
      settings: { period: 'this_month', compare: 'previous_period' } as never,
      created_by: store.teamMember?.id ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    toast.showToast(t('The page was not created: ', 'La página no se ha creado: ') + (error?.message ?? ''), 'error')
    return
  }
  creating.value = false
  router.push({ path: `/reports/pages/${data.id}`, query: tpl ? {} : { edit: '1' } })
}
const SPAN_MINI: Record<number, string> = { 3: 'col-span-3', 4: 'col-span-4', 6: 'col-span-6', 8: 'col-span-8', 12: 'col-span-12' }
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Reports', 'Informes')">
      <UiBtn variant="primary" data-cy="report-page-new" @click="openCreate()">+ {{ t('New report page', 'Nueva página de informes') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="p-4 sm:p-6">
        <p class="text-[13px] text-ink-muted2">{{ t('Metrics across patients, appointments, and billing. Each report below has its own filters and date range.', 'Métricas de pacientes, citas y facturación. Cada informe tiene sus propios filtros y periodo.') }}</p>
        <p v-if="reportsPractitionerId" class="mt-3 max-w-[960px] rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700" data-cy="reports-own-only-note">
          {{ t('Your role shows you only your own figures: your appointments, your takings and your patients.', 'Tu rol te enseña solo tus datos: tus citas, tus cobros y tus pacientes.') }}
        </p>
        <section class="mt-6 max-w-[960px]" data-cy="report-pages">
          <h2 class="text-[15px] font-[620] text-ink-900">{{ t('Report pages', 'Páginas de informes') }}</h2>
          <p class="mt-0.5 text-[13px] text-ink-muted2">{{ t('Your own dashboards: the numbers you look at together on one page, downloadable as a PDF.', 'Tus propios paneles: las cifras que miras juntas en una página, descargables en PDF.') }}</p>
          <div class="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <template v-if="pagesLoading">
              <UiSkeleton v-for="i in 3" :key="i" class="h-40 rounded-card" />
            </template>
            <NuxtLink
              v-for="p in cards"
              v-else
              :key="p.id"
              :to="`/reports/pages/${p.id}`"
              class="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors hover:border-brand-tintBorder"
              data-cy="report-page-card"
            >
              <div class="grid grid-cols-12 gap-1 border-b border-line-row bg-surface-subtle p-3" aria-hidden="true">
                <span v-for="b in p.blocks.slice(0, 8)" :key="b.id" :class="[SPAN_MINI[b.span], b.config.chart === 'number' ? 'h-4 bg-brand-tint' : 'h-8 bg-brand-tintBorder']" class="rounded-sm" />
                <span v-if="p.blocks.length === 0" class="col-span-12 h-8 rounded-sm border border-dashed border-line-control" />
              </div>
              <div class="flex flex-col gap-0.5 p-3">
                <span class="text-[14px] font-semibold text-ink-900 group-hover:text-brand-text">{{ p.name }}</span>
                <span class="line-clamp-1 text-[12.5px] text-ink-muted2">{{ p.summary || t('No blocks yet', 'Sin bloques todavía') }}</span>
                <span class="text-[12px] text-ink-faint2">{{ p.meta }}</span>
              </div>
            </NuxtLink>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-dashed border-line-control px-3.5 py-2.5 text-[13px] text-ink-muted2">
            <button type="button" class="font-medium text-brand-text hover:underline" @click="openCreate()">+ {{ t('New page', 'Nueva página') }}</button>
            <span>{{ t('— start empty, or from a template:', '— vacía, o desde una plantilla:') }}</span>
            <template v-for="(tpl, i) in templates" :key="tpl.key">
              <span v-if="i > 0" aria-hidden="true">·</span>
              <button type="button" class="text-brand-text hover:underline" :data-cy="`report-template-${tpl.key}`" @click="openCreate(tpl.key)">{{ tpl.name }}</button>
            </template>
          </div>
        </section>

        <div class="mt-10 max-w-[960px]">
          <h2 class="text-[15px] font-[620] text-ink-900">{{ t('Standard reports', 'Informes estándar') }}</h2>
          <p class="mb-5 mt-0.5 text-[13px] text-ink-muted2">{{ t('Each one downloads as a PDF with its filters, and its sections can be added to a report page.', 'Cada uno se descarga en PDF con sus filtros, y sus secciones se pueden añadir a una página de informes.') }}</p>
          <IconLinkGrid :groups="groups" />
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="creating"
      :title="t('New report page', 'Nueva página de informes')"
      :confirm-label="t('Create', 'Crear')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :disabled="!newName.trim()"
      @confirm="createPage"
      @cancel="creating = false"
    >
      <div class="space-y-3 text-left" data-cy="report-page-create">
        <label class="block text-[12.5px] font-medium text-ink-700">
          {{ t('Name', 'Nombre') }}
          <input v-model="newName" type="text" maxlength="120" data-cy="report-page-create-name" class="mt-1 h-9 w-full rounded-ctl border border-line-control px-3 text-[13px] font-normal focus:border-brand focus:outline-none" />
        </label>
        <label class="block text-[12.5px] font-medium text-ink-700">
          {{ t('Start from', 'Empezar desde') }}
          <select v-model="newTemplate" data-cy="report-page-create-template" class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] font-normal">
            <option value="">{{ t('An empty page', 'Una página vacía') }}</option>
            <option v-for="tpl in templates" :key="tpl.key" :value="tpl.key">{{ tpl.name }} — {{ tpl.description }}</option>
          </select>
        </label>
        <fieldset class="space-y-1.5 text-[13px] text-ink-700">
          <legend class="mb-1 text-[12.5px] font-medium">{{ t('Who can see it', 'Quién puede verla') }}</legend>
          <label class="flex items-center gap-2"><input v-model="newVisibility" type="radio" value="clinic" class="accent-brand" /> {{ t('Everyone in the clinic with access to reports', 'Todos en la clínica con acceso a informes') }}</label>
          <label class="flex items-center gap-2"><input v-model="newVisibility" type="radio" value="private" class="accent-brand" data-cy="report-page-create-private" /> {{ t('Only me', 'Solo yo') }}</label>
        </fieldset>
      </div>
    </UiConfirmDialog>
  </div>
</template>
