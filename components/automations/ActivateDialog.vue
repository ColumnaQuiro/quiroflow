<script setup lang="ts">
import { isLeadAtom, type TriggerAtom } from '~/utils/automationTrigger'
import { atomTitle } from '~/utils/automationTriggerText'
import { filtersText, type NameLookup } from '~/utils/automationDescribe'
import { BACKFILL_DAY_OPTIONS, BACKFILL_DEFAULT_DAYS, BACKFILL_MAX_PATIENTS, canBackfill } from '~/utils/automationBackfill'

// Switching an automation on, said before it happens: from now on, who enters
// it and on what; who is already inside and carries on; and whether it really
// sends (test mode, marketing consent). A group (segment) has its own dialog,
// AutomationsSegmentActivateDialog, which can count who matches today; an
// event trigger has nobody to count yet, so this says what will start it.
// Pausing needs no dialog: it is always safe and switching back on resumes.
//
// Where the trigger allows it (utils/automationBackfill.ts), it also asks
// whom it includes: only from now on, or also everyone who already met it in
// the last N days -- a one-off pass, counted here before anything is sent
// (/api/automations/backfill-preview) and made by the page once it is on.

const props = defineProps<{
  name: string
  trigger: TriggerAtom
  filters: Record<string, any> | null | undefined
  lookup: NameLookup
  isMarketing: boolean
  dryRun: boolean
  /** People inside it now -- paused, they wait at their step and resume. */
  inside: number
  /** The saved automation, so the count leaves out whoever it has already reached. */
  ruleId?: string | null
  busy?: boolean
}>()
/** `backfillDays`: also enrol who met it in the last that many days; null for only from now on. */
const emit = defineEmits<{ confirm: [backfillDays: number | null]; cancel: [] }>()
const t = useT()

// ---- "also everyone who already meets it"
const offersBackfill = computed(() => canBackfill(props.trigger))
const scope = ref<'now' | 'also'>('now')
const days = ref<number>(BACKFILL_DEFAULT_DAYS)
const preview = ref<{ count: number; more: boolean } | null>(null)
const counting = ref(false)
const countFailed = ref(false)
let asked = 0
async function count() {
  const mine = ++asked
  counting.value = true
  countFailed.value = false
  try {
    const res = await useStaffFetch<{ supported: boolean; count: number; more: boolean }>('/api/automations/backfill-preview', {
      method: 'POST',
      body: { trigger: props.trigger, filters: props.filters ?? {}, isMarketing: props.isMarketing, ruleId: props.ruleId ?? null, days: days.value },
    })
    if (mine === asked) preview.value = { count: res.count, more: res.more }
  } catch {
    if (mine === asked) {
      preview.value = null
      countFailed.value = true
    }
  } finally {
    if (mine === asked) counting.value = false
  }
}
watch([scope, days], () => {
  if (scope.value === 'also') count()
})
const countText = computed(() => {
  const p = preview.value
  if (!p) return ''
  if (p.more) return t(`Only the ${BACKFILL_MAX_PATIENTS} most recent will be included.`, `Solo se incluirán los ${BACKFILL_MAX_PATIENTS} más recientes.`)
  if (p.count === 0) return t('Nobody met it in that time.', 'Nadie la cumplió en ese periodo.')
  if (p.count === 1) return t('This will include 1 patient.', 'Esto incluirá a 1 paciente.')
  return t(`This will include ${p.count} patients.`, `Esto incluirá a ${p.count} pacientes.`)
})
function confirm() {
  emit('confirm', offersBackfill.value && scope.value === 'also' ? days.value : null)
}

const when = computed(() => {
  const detail = filtersText(t, props.filters, props.lookup)
  const head = atomTitle(t, props.trigger, props.filters)
  return detail ? `${head} · ${detail}` : head
})
const lead = computed(() => isLeadAtom(props.trigger))
const title = computed(() => t(`Switch on "${props.name}"?`, `¿Activar «${props.name}»?`))
</script>

<template>
  <UiConfirmDialog
    :title="title"
    :confirm-label="t('Switch on', 'Activar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    :disabled="scope === 'also' && counting"
    @confirm="confirm"
    @cancel="emit('cancel')"
  >
    <div class="flex flex-col gap-3 text-[14px] leading-relaxed text-ink-500" data-test="activate-dialog">
      <p>
        {{ lead
          ? t('From now on, every new lead that meets this enters and receives its steps:', 'A partir de ahora, cada lead nuevo que cumpla esto entra y recibe sus pasos:')
          : t('From now on, every patient who meets this enters and receives its steps:', 'A partir de ahora, cada paciente que cumpla esto entra y recibe sus pasos:') }}
      </p>
      <p class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 font-semibold text-ink-900" data-test="activate-when">{{ when }}</p>
      <fieldset v-if="offersBackfill" class="flex flex-col gap-2" data-test="activate-backfill">
        <legend class="mb-1 text-[13px] font-semibold text-ink-700">{{ t('Who it includes', '¿A quién incluye?') }}</legend>
        <label class="flex items-start gap-2 text-[14px] text-ink-700 touch:min-h-11">
          <input v-model="scope" type="radio" value="now" name="activate-scope" class="mt-1 h-4 w-4 accent-brand" data-test="activate-scope-now" />
          <span>
            <span class="font-semibold text-ink-900">{{ t('Only from now on', 'Solo a partir de ahora') }}</span>
            <span class="block text-[13px] text-ink-muted">{{ t('Whoever meets it after you switch it on.', 'Quien la cumpla desde que la actives.') }}</span>
          </span>
        </label>
        <label class="flex items-start gap-2 text-[14px] text-ink-700 touch:min-h-11">
          <input v-model="scope" type="radio" value="also" name="activate-scope" class="mt-1 h-4 w-4 accent-brand" data-test="activate-scope-also" />
          <span>
            <span class="font-semibold text-ink-900">{{ t('Also everyone who already meets it', 'También a todos los que ya cumplen la condición') }}</span>
            <span class="block text-[13px] text-ink-muted">{{ t('Once, now, plus everyone from now on.', 'Una sola vez, ahora, y además todos los nuevos.') }}</span>
          </span>
        </label>
        <div v-if="scope === 'also'" class="ml-6 flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[13px]">
          <label class="flex flex-wrap items-center gap-2">
            <span>{{ t('Those who met it in the last', 'Quienes la cumplieron en los últimos') }}</span>
            <select v-model.number="days" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-900 touch:h-11" data-test="activate-backfill-days">
              <option v-for="d in BACKFILL_DAY_OPTIONS" :key="d" :value="d">{{ t(`${d} days`, `${d} días`) }}</option>
            </select>
          </label>
          <p class="font-semibold text-ink-900" aria-live="polite" data-test="activate-backfill-count">
            {{ counting ? t('Counting…', 'Contando…') : countFailed ? t('Could not count them. Try again.', 'No se han podido contar. Vuelve a intentarlo.') : countText }}
          </p>
          <p class="text-ink-muted">{{ t('Nobody it has already reached, and no minors, archived patients or anyone marked "do not contact".', 'No entra nadie a quien ya haya llegado, ni menores, archivados o marcados «no contactar».') }}</p>
        </div>
      </fieldset>
      <p v-if="inside > 0" data-test="activate-inside">
        <strong class="text-ink-900">{{ inside === 1 ? t('1 person', '1 persona') : t(`${inside} people`, `${inside} personas`) }}</strong>
        {{ inside === 1
          ? t('already inside carries on from the step where it stopped.', 'que ya estaba dentro sigue desde el paso en que se quedó.')
          : t('already inside carry on from the step where they stopped.', 'que ya estaban dentro siguen desde el paso en que se quedaron.') }}
      </p>
      <p v-if="dryRun" class="rounded-ctl border border-info-border bg-info-bg px-3 py-2.5 text-[13px] text-info-text" data-test="activate-test-mode">
        {{ t('Test mode: nothing is sent to anyone. What would have been sent is recorded so you can check it.', 'Modo prueba: no se envía nada a nadie. Queda registrado lo que se habría enviado para que lo revises.') }}
      </p>
      <p v-else-if="isMarketing" class="text-[13px]" data-test="activate-marketing">
        {{ t('It is marketing: each channel only reaches people who accepted it.', 'Es comercial: cada canal solo llega a quien lo aceptó.') }}
      </p>
    </div>
  </UiConfirmDialog>
</template>
