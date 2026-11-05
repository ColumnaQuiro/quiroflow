<script setup lang="ts">
import { DEFAULT_PLACE_RADIUS, HABIT_KINDS, habitTimes, kindLabel, newHabit, type Habit, type HabitDays, type HabitKind, type HabitPlace } from '../../../../utils/habits'

// Creating or changing one of "Mis hábitos": which habit, how many times a
// day, between which hours, which days -- and optionally only while the
// phone is at places the patient saved ("Dónde"). The places are saved where
// the phone is when they tap "Estoy aquí ahora"; they and the location stay
// on the phone (useHabitReminders explains the native side). A place-bound
// habit needs location "Always": without it, it reminds by time only, and
// this screen says so.
definePageMeta({ layout: 'patient' })

const t = useT()
const route = useRoute()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')
const { habits, places, save, reminders } = useHabits(() => patientId.value)
const { preference: lang } = useLang()

const isNew = route.params.id === 'new'
const existing = computed(() => habits.value.find((h) => h.id === route.params.id))
const form = reactive<Habit>(isNew ? newHabit('agua', crypto.randomUUID()) : { ...newHabit('agua', String(route.params.id)) })
const placeList = ref<HabitPlace[]>([...places.value])
watch(existing, (h) => { if (h) Object.assign(form, { ...h, placeIds: [...h.placeIds] }) }, { immediate: true })
watch(places, (p) => { placeList.value = [...p] })

const kinds = Object.keys(HABIT_KINDS) as HabitKind[]
function pickKind(k: HabitKind) {
  const fresh = newHabit(k, form.id)
  // Keep what they already chose; take the new kind's own defaults only on a new habit.
  Object.assign(form, isNew ? { ...fresh, days: form.days, placeIds: form.placeIds } : { kind: k })
}
const times = computed(() => habitTimes(form))
const DAYS: [HabitDays, string][] = [['all', t('Every day', 'Todos')], ['weekdays', t('Mon to Fri', 'Lunes a viernes')], ['weekend', t('Weekend', 'Fin de semana')]]

// Dónde.
const onlyAtPlaces = ref(form.placeIds.length > 0)
watch(() => form.placeIds.length, (n) => { if (n) onlyAtPlaces.value = true })
const location = ref<'always' | 'whenInUse' | 'denied' | 'prompt' | null>(null)
onMounted(async () => { location.value = (await reminders.checkPermissions()).location })
const newPlaceName = ref(t('Home', 'Casa'))
const locating = ref(false)
const placeError = ref('')
async function saveHere() {
  placeError.value = ''
  const name = newPlaceName.value.trim()
  if (!name) return (placeError.value = t('Give the place a name.', 'Ponle un nombre al lugar.'))
  locating.value = true
  try {
    const { lat, lng } = await reminders.currentPosition()
    const place: HabitPlace = { id: crypto.randomUUID(), name, lat, lng, radius: DEFAULT_PLACE_RADIUS, address: '' }
    placeList.value = [...placeList.value, place]
    form.placeIds = [...form.placeIds, place.id]
    newPlaceName.value = placeList.value.length > 1 ? '' : t('Work', 'Trabajo')
  } catch {
    placeError.value = t("Couldn't find where you are. Allow location for QuiroFlow and try again.", 'No se ha podido saber dónde estás. Permite la ubicación a QuiroFlow y vuelve a probar.')
  } finally {
    locating.value = false
  }
}
function togglePlace(id: string) {
  form.placeIds = form.placeIds.includes(id) ? form.placeIds.filter((x) => x !== id) : [...form.placeIds, id]
}
function forgetPlace(id: string) {
  placeList.value = placeList.value.filter((p) => p.id !== id)
  form.placeIds = form.placeIds.filter((x) => x !== id)
}

const saving = ref(false)
const error = ref('')
async function submit() {
  error.value = ''
  if (form.to < form.from) return (error.value = t('The last one cannot be before the first.', 'El último no puede ser antes que el primero.'))
  if (onlyAtPlaces.value && !form.placeIds.length) return (error.value = t('Choose a place, or "Anywhere".', 'Elige un lugar, o «En cualquier sitio».'))
  saving.value = true
  const habit: Habit = { ...form, placeIds: onlyAtPlaces.value ? [...form.placeIds] : [] }
  const next = isNew ? [...habits.value, habit] : habits.value.map((h) => (h.id === habit.id ? habit : h))
  // A place no habit uses any more is forgotten.
  const used = new Set(next.flatMap((h) => h.placeIds))
  const r = await save(next, placeList.value.filter((p) => used.has(p.id)))
  if ('error' in r) {
    saving.value = false
    return (error.value = r.error)
  }
  if ((await reminders.checkPermissions()).notifications !== 'granted') await reminders.requestNotifications()
  if (habit.placeIds.length && location.value !== 'always') location.value = (await reminders.requestLocationAlways()).location
  saving.value = false
  await navigateTo('/care/habits')
}
async function remove() {
  const next = habits.value.filter((h) => h.id !== form.id)
  const used = new Set(next.flatMap((h) => h.placeIds))
  await save(next, places.value.filter((p) => used.has(p.id)))
  await navigateTo('/care/habits')
}

const chip = (on: boolean) => (on ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700')
const field = 'h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-center font-mono text-[16px] text-ink-900'
</script>

<template>
  <PatientScreen :title="isNew ? t('New habit', 'Nuevo hábito') : kindLabel(form.kind, lang)">
    <form class="flex flex-col gap-5" data-cy="habit-form" @submit.prevent="submit">
      <fieldset>
        <legend class="mb-2 text-[10.5px] font-[650] uppercase tracking-[.05em] text-ink-muted">{{ t('Habit', 'Hábito') }}</legend>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="k in kinds" :key="k" type="button" class="h-9 rounded-pill border px-3 text-[13px] font-semibold" :class="chip(form.kind === k)" :aria-pressed="form.kind === k" :data-cy="`habit-kind-${k}`" @click="pickKind(k)">{{ kindLabel(k, lang) }}</button>
        </div>
        <input v-if="form.kind === 'otro'" v-model="form.label" type="text" :placeholder="t('What is it?', '¿Qué es?')" class="mt-2 h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px]" data-cy="habit-label" />
      </fieldset>

      <fieldset>
        <legend class="mb-2 text-[10.5px] font-[650] uppercase tracking-[.05em] text-ink-muted">{{ t('Times a day', 'Veces al día') }}</legend>
        <div class="flex items-center gap-3">
          <button type="button" class="h-11 w-11 rounded-ctl border border-line-control bg-surface text-[20px] text-brand-text" :aria-label="t('Fewer', 'Menos')" data-cy="habit-fewer" @click="form.timesPerDay = Math.max(1, form.timesPerDay - 1)">−</button>
          <span class="flex-1 text-center font-mono text-[22px] text-ink-900" data-cy="habit-times">{{ form.timesPerDay }}</span>
          <button type="button" class="h-11 w-11 rounded-ctl border border-line-control bg-surface text-[20px] text-brand-text" :aria-label="t('More', 'Más')" data-cy="habit-more" @click="form.timesPerDay = Math.min(12, form.timesPerDay + 1)">+</button>
        </div>
      </fieldset>

      <fieldset>
        <legend class="mb-2 text-[10.5px] font-[650] uppercase tracking-[.05em] text-ink-muted">{{ form.timesPerDay > 1 ? t('Between', 'Entre') : t('At', 'A las') }}</legend>
        <div class="flex items-center gap-2.5">
          <input v-model="form.from" type="time" step="300" :class="field" :aria-label="t('First', 'Primero')" data-cy="habit-from" />
          <template v-if="form.timesPerDay > 1">
            <span class="text-[12.5px] text-ink-muted">{{ t('and', 'y') }}</span>
            <input v-model="form.to" type="time" step="300" :class="field" :aria-label="t('Last', 'Último')" data-cy="habit-to" />
          </template>
        </div>
      </fieldset>

      <fieldset>
        <legend class="mb-2 text-[10.5px] font-[650] uppercase tracking-[.05em] text-ink-muted">{{ t('Which days', 'Qué días') }}</legend>
        <div class="flex overflow-hidden rounded-ctl border border-line-control bg-surface">
          <button v-for="[k, label] in DAYS" :key="k" type="button" class="h-10 flex-1 text-[13px] font-semibold" :class="form.days === k ? 'bg-brand-tint text-brand-text' : 'text-ink-700'" :aria-pressed="form.days === k" :data-cy="`habit-days-${k}`" @click="form.days = k">{{ label }}</button>
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-2" data-cy="habit-where">
        <legend class="mb-2 text-[10.5px] font-[650] uppercase tracking-[.05em] text-ink-muted">{{ t('Where', 'Dónde') }}</legend>
        <label class="flex items-center gap-2.5 rounded-card border px-3.5 py-3 text-[14.5px] text-ink-900" :class="!onlyAtPlaces ? 'border-brand bg-brand-tint' : 'border-line bg-surface'">
          <input v-model="onlyAtPlaces" type="radio" :value="false" data-cy="habit-anywhere" />
          <span><span class="font-semibold">{{ t('Anywhere', 'En cualquier sitio') }}</span><br /><span class="text-[12.5px] text-ink-muted">{{ t('By time only.', 'Solo por horas.') }}</span></span>
        </label>
        <label class="flex items-center gap-2.5 rounded-card border px-3.5 py-3 text-[14.5px] text-ink-900" :class="onlyAtPlaces ? 'border-brand bg-brand-tint' : 'border-line bg-surface'">
          <input v-model="onlyAtPlaces" type="radio" :value="true" data-cy="habit-at-places" />
          <span><span class="font-semibold">{{ t('Only at these places', 'Solo en estos lugares') }}</span><br /><span class="text-[12.5px] text-ink-muted">{{ t('It reminds you at its time if you are there.', 'Te avisa a su hora si estás allí.') }}</span></span>
        </label>
        <template v-if="onlyAtPlaces">
          <div v-if="placeList.length" class="rounded-card border border-line bg-surface px-3.5 py-1">
            <div v-for="p in placeList" :key="p.id" class="flex min-h-[52px] items-center gap-2.5 border-b border-line-row last:border-0">
              <input :id="`place-${p.id}`" type="checkbox" :checked="form.placeIds.includes(p.id)" data-cy="habit-place" @change="togglePlace(p.id)" />
              <label :for="`place-${p.id}`" class="min-w-0 flex-1 text-[14.5px]"><span class="font-semibold text-ink-900">{{ p.name }}</span><br /><span class="text-[12.5px] text-ink-muted">{{ t(`${p.radius} m around where you saved it`, `${p.radius} m alrededor de donde lo guardaste`) }}</span></label>
              <button type="button" class="text-[12.5px] font-medium text-ink-muted" @click="forgetPlace(p.id)">{{ t('Forget', 'Olvidar') }}</button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <input v-model="newPlaceName" type="text" :placeholder="t('Name: Home, Work…', 'Nombre: Casa, Trabajo…')" class="h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[15px]" data-cy="habit-place-name" />
            <button type="button" class="h-11 shrink-0 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-semibold text-brand-text disabled:opacity-60" :disabled="locating" data-cy="habit-place-here" @click="saveHere">{{ locating ? t('Finding you…', 'Buscando…') : t("I'm here now", 'Estoy aquí ahora') }}</button>
          </div>
          <p v-if="placeError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ placeError }}</p>
          <div v-if="location !== 'always'" class="rounded-card border border-warning-border bg-warning-bg px-3.5 py-3" data-cy="habit-location-note">
            <p class="text-[13.5px] font-semibold text-ink-900">{{ t('Needs location "Always"', 'Necesita la ubicación «Siempre»') }}</p>
            <p class="mt-0.5 text-[12.5px] text-ink-700">{{ t('So the phone knows you got home with the app closed. Without it, this habit reminds you by time only. Your location never leaves the phone.', 'Para saber que has llegado a casa con la app cerrada. Si no la das, este hábito avisa solo por horas. Tu ubicación no sale del teléfono.') }}</p>
          </div>
        </template>
      </fieldset>

      <div class="rounded-card border border-brand/25 bg-brand-tint/50 px-4 py-3">
        <p class="text-[10.5px] font-[650] uppercase tracking-[.05em] text-ink-muted">{{ t("We'll remind you at", 'Te avisaremos a las') }}</p>
        <p class="mt-1 font-mono text-[14px] text-ink-900" data-cy="habit-preview">{{ times.map((x) => x.replace(/^0/, '')).join(' · ') }}</p>
        <p v-if="onlyAtPlaces && form.placeIds.length" class="mt-1 text-[12.5px] text-ink-muted">{{ t('Only if you are there at that time.', 'Solo si a esa hora estás allí.') }}</p>
      </div>

      <p v-if="error" role="alert" class="text-[13px] font-semibold text-danger-text">{{ error }}</p>
      <button type="submit" class="h-12 rounded-card bg-brand text-[15px] font-bold text-white disabled:opacity-60" :disabled="saving" data-cy="habit-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</button>
      <button v-if="!isNew" type="button" class="h-11 text-[14px] font-semibold text-danger-text" data-cy="habit-delete" @click="remove">{{ t('Delete this habit', 'Borrar este hábito') }}</button>
    </form>
  </PatientScreen>
</template>
