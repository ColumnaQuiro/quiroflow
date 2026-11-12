<script setup lang="ts">
import { maintenanceConfig, MAINTENANCE_COLUMNS, type MaintenanceRow, type PlanShape } from '~/utils/planRenewal'
import { formatEur } from '~/utils/billing'

// Settings > Care plans: what the review at the end of a care plan proposes
// (AppointmentsPlanRenewal, utils/planRenewal.ts) -- the clinic's maintenance
// (how often, how long, which membership), when a discharged patient is back
// in Recalls, and the habits pack: readings from Education sent when someone
// moves to maintenance and, if wanted, at discharge.
//
// All of it lives on accounts (20261105163000_clinic_maintenance), under
// clinic_config like the rest of this group. One Save writes it all.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const loading = ref(true)
const saving = ref(false)
const shape = ref<PlanShape>({ visits_per_period: 1, frequency_value: 1, frequency_unit: 'month', total_visits: null })
const membershipId = ref('')
const recallMonths = ref(3)
const articleIds = ref<string[]>([])
const onStart = ref(true)
const onDischarge = ref(false)
const memberships = ref<{ id: string; name: string; price_cents: number; billing_interval: string | null; billing_interval_count: number | null }[]>([])
const articles = ref<{ id: string; title: string; video_url: string | null; minutes: number | null }[]>([])
const saved = ref('')

const snapshot = () => JSON.stringify([shape.value, membershipId.value, recallMonths.value, articleIds.value, onStart.value, onDischarge.value])
const dirty = computed(() => !loading.value && snapshot() !== saved.value)

onMounted(async () => {
  const [{ data: account }, { data: mems }, { data: arts }] = await Promise.all([
    supabase.from('accounts').select(MAINTENANCE_COLUMNS).eq('id', store.accountId!).single(),
    supabase.from('memberships').select('id, name, price_cents, billing_interval, billing_interval_count').order('name'),
    supabase.from('learn_articles').select('id, title, video_url, minutes').is('archived_at', null).order('title'),
  ])
  memberships.value = mems ?? []
  articles.value = arts ?? []
  const c = maintenanceConfig(account as MaintenanceRow | null)
  shape.value = { visits_per_period: c.visits_per_period, frequency_value: c.frequency_value, frequency_unit: c.frequency_unit, total_visits: c.total_visits }
  // One that has since been deleted reads as none.
  membershipId.value = memberships.value.some((m) => m.id === c.membershipId) ? c.membershipId! : ''
  recallMonths.value = c.dischargeRecallMonths
  articleIds.value = c.habitsArticleIds.filter((id) => articles.value.some((a) => a.id === id))
  onStart.value = c.habitsOnStart
  onDischarge.value = c.habitsOnDischarge
  saved.value = snapshot()
  loading.value = false
})

const pack = computed(() => articleIds.value.map((id) => articles.value.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a))
const addable = computed(() => articles.value.filter((a) => !articleIds.value.includes(a.id)))
const adding = ref('')
function addArticle() {
  if (!adding.value) return
  articleIds.value = [...articleIds.value, adding.value]
  adding.value = ''
}
function move(index: number, by: -1 | 1) {
  const target = index + by
  if (target < 0 || target >= articleIds.value.length) return
  const list = [...articleIds.value]
  const [moved] = list.splice(index, 1)
  list.splice(target, 0, moved!)
  articleIds.value = list
}
function remove(id: string) {
  articleIds.value = articleIds.value.filter((x) => x !== id)
}

function periodLabel(m: { billing_interval: string | null; billing_interval_count: number | null }) {
  const n = m.billing_interval_count ?? 1
  if (m.billing_interval === 'year') return n === 1 ? t('/year', '/año') : t(` every ${n} years`, ` cada ${n} años`)
  if (m.billing_interval === 'week') return n === 1 ? t('/week', '/semana') : t(` every ${n} weeks`, ` cada ${n} semanas`)
  return n === 1 ? t('/month', '/mes') : t(` every ${n} months`, ` cada ${n} meses`)
}

async function save() {
  saving.value = true
  const months = Math.min(24, Math.max(1, Math.round(recallMonths.value || 3)))
  recallMonths.value = months
  const { error } = await supabase
    .from('accounts')
    .update({
      maintenance_visits_per_period: shape.value.visits_per_period,
      maintenance_frequency_value: shape.value.frequency_value,
      maintenance_frequency_unit: shape.value.frequency_unit,
      maintenance_total_visits: shape.value.total_visits,
      maintenance_membership_id: membershipId.value || null,
      maintenance_discharge_recall_months: months,
      maintenance_habits_article_ids: articleIds.value,
      maintenance_habits_on_start: onStart.value,
      maintenance_habits_on_discharge: onDischarge.value,
    })
    .eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  saved.value = snapshot()
  showToast(t('Saved', 'Guardado'))
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700 disabled:opacity-30'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Care plans', 'Planes de cuidados')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="care-plan-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What the review at the end of a care plan proposes. Whoever does the review can still change it for each patient.', 'Lo que propone la revisión al final de un plan de tratamiento. Quien hace la revisión lo puede cambiar para cada paciente.') }}
          </p>

          <template v-if="loading">
            <div v-for="i in 3" :key="i" class="rounded-card border border-line bg-surface px-[18px] py-5"><UiSkeleton class="h-4 w-48 rounded-ctlSm" /></div>
          </template>
          <template v-else>
            <section aria-labelledby="h-maintenance" class="rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-maintenance" class="text-[16px] font-bold text-ink-900">{{ t('Maintenance', 'Mantenimiento') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('"Keep coming" at the review starts a plan like this.', '«Seguir viniendo» en la revisión empieza un plan así.') }}</p>
              </div>
              <div class="flex flex-col gap-4 border-t border-line-row px-[18px] py-4">
                <AppointmentsPlanShapeFields v-model="shape" cy-prefix="maintenance" />
                <label class="flex flex-wrap items-center gap-2.5 text-[13.5px] text-ink-900">
                  {{ t('Offer the membership', 'Ofrecer la membresía') }}
                  <select v-model="membershipId" :class="[inputClass, 'min-w-[220px]']" data-cy="maintenance-membership">
                    <option value="">{{ t('None', 'Ninguna') }}</option>
                    <option v-for="m in memberships" :key="m.id" :value="m.id">{{ m.name }} · {{ formatEur(m.price_cents) }}{{ periodLabel(m) }}</option>
                  </select>
                </label>
                <p v-if="!memberships.length" class="-mt-2 text-[12.5px] text-ink-muted">
                  {{ t('No memberships yet.', 'Aún no hay membresías.') }} <NuxtLink to="/settings/memberships" class="font-medium text-brand-text hover:underline">{{ t('Create one in Memberships', 'Créala en Membresías') }}</NuxtLink>
                </p>
                <p class="text-[12.5px] text-ink-muted">
                  {{ shape.total_visits === null ? t("No end: the record counts the visits since it started, and warns when the next one isn't booked.", 'Sin fin: la ficha cuenta las visitas desde que empezó y avisa si no tiene la siguiente reservada.') : t('The review comes back when the plan is about to end.', 'La revisión vuelve cuando el plan está por terminar.') }}
                </p>
              </div>
            </section>

            <section aria-labelledby="h-discharge" class="rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-discharge" class="text-[16px] font-bold text-ink-900">{{ t('At discharge', 'Al dar el alta') }}</h2>
              </div>
              <label class="flex flex-wrap items-center gap-2.5 border-t border-line-row px-[18px] py-4 text-[13.5px] text-ink-900">
                {{ t('Back in Recalls after', 'Volver a Recordatorios a los') }}
                <input v-model.number="recallMonths" type="number" min="1" max="24" :class="[inputClass, 'w-16 text-center font-mono']" data-cy="maintenance-recall-months" />
                {{ recallMonths === 1 ? t('month', 'mes') : t('months', 'meses') }}
              </label>
            </section>

            <section aria-labelledby="h-habits" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="habits-pack">
              <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
                <div class="min-w-0 flex-1">
                  <h2 id="h-habits" class="text-[16px] font-bold text-ink-900">{{ t(`Habits pack · ${pack.length}`, `Paquete de hábitos · ${pack.length}`) }}</h2>
                  <p class="mt-1 text-[13px] text-ink-muted">{{ t('Readings from Education, sent in this order. Anything the patient already has is not sent again.', 'Lecturas de Educación, en este orden. Lo que el paciente ya tiene no se repite.') }}</p>
                </div>
                <NuxtLink to="/settings/education" class="shrink-0 text-[13px] font-medium text-brand-text hover:underline">{{ t('Edit in Education', 'Editar en Educación') }}</NuxtLink>
              </div>
              <p v-if="!pack.length" class="border-t border-line-row px-[18px] py-5 text-center text-[14px] text-ink-muted">{{ t('No readings yet. Add the first one below.', 'Aún no hay lecturas. Añade la primera abajo.') }}</p>
              <div v-for="(a, i) in pack" :key="a.id" class="flex min-h-[52px] items-center gap-2 border-t border-line-row py-1.5 pl-[18px] pr-3" data-cy="habits-pack-row">
                <span class="min-w-0 flex-1 truncate text-[14.5px] text-ink-900" data-cy="habits-pack-title">{{ a.title }}</span>
                <span class="inline-flex h-5 items-center rounded-pill bg-surface-subtle px-2 text-[11px] font-semibold text-ink-600">{{ a.video_url ? t('Video', 'Vídeo') : t('Reading', 'Lectura') }}</span>
                <button type="button" :class="iconBtn" :disabled="i === 0" :aria-label="t(`Move ${a.title} up`, `Subir ${a.title}`)" @click="move(i, -1)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button type="button" :class="iconBtn" :disabled="i === pack.length - 1" :aria-label="t(`Move ${a.title} down`, `Bajar ${a.title}`)" @click="move(i, 1)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <button type="button" :class="iconBtn" :aria-label="t(`Remove ${a.title}`, `Quitar ${a.title}`)" data-cy="habits-pack-remove" @click="remove(a.id)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <form v-if="addable.length" class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3" @submit.prevent="addArticle">
                <select v-model="adding" :aria-label="t('Reading to add', 'Lectura para añadir')" :class="[inputClass, 'min-w-0 flex-1']" data-cy="habits-pack-add">
                  <option value="" disabled>{{ t('Add a reading…', 'Añadir una lectura…') }}</option>
                  <option v-for="a in addable" :key="a.id" :value="a.id">{{ a.title }}</option>
                </select>
                <UiBtn type="submit" :disabled="!adding" data-cy="habits-pack-add-save">{{ t('Add', 'Añadir') }}</UiBtn>
              </form>
              <p v-else-if="!articles.length" class="border-t border-line-row bg-surface-subtle px-[18px] py-3 text-[13px] text-ink-muted">
                {{ t('Education has no readings yet.', 'Educación aún no tiene lecturas.') }}
              </p>
              <div class="flex flex-col gap-2 border-t border-line-row px-[18px] py-4">
                <label class="flex items-center gap-2.5 text-[13.5px] text-ink-900"><input v-model="onStart" type="checkbox" class="h-4 w-4 accent-brand" data-cy="habits-on-start" />{{ t('Send it on moving to maintenance', 'Enviarlo al pasar a mantenimiento') }}</label>
                <label class="flex items-center gap-2.5 text-[13.5px] text-ink-900"><input v-model="onDischarge" type="checkbox" class="h-4 w-4 accent-brand" data-cy="habits-on-discharge" />{{ t('Also send it at discharge', 'Enviarlo también al dar el alta') }}</label>
              </div>
            </section>

            <div class="flex justify-end">
              <UiBtn variant="primary" :disabled="saving || !dirty" data-cy="care-plan-settings-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
