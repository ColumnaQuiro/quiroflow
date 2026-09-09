<script setup lang="ts">
// Native <input type="date"> on Android defaults to a calendar grid with no
// direct way to jump to a year -- for a date of birth that means paging
// back a month at a time through decades. Day/month/year selects sidestep
// that entirely: the year is always one dropdown-tap away, on any browser.
const props = defineProps<{ modelValue: string | null | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()
const t = useT()

function parse(v: string | null | undefined) {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null
  return { year: m?.[1] ?? '', month: m?.[2] ?? '', day: m?.[3] ?? '' }
}

const initial = parse(props.modelValue)
const day = ref(initial.day)
const month = ref(initial.month)
const year = ref(initial.year)

// A patientField link (see docFields.ts) can resolve and prefill this
// after mount -- keep the selects in sync if modelValue changes from
// outside rather than only reading it once.
watch(
  () => props.modelValue,
  (v) => {
    const p = parse(v)
    day.value = p.day
    month.value = p.month
    year.value = p.year
  },
)

const MONTHS = [
  { value: '01', label: t('January', 'Enero') },
  { value: '02', label: t('February', 'Febrero') },
  { value: '03', label: t('March', 'Marzo') },
  { value: '04', label: t('April', 'Abril') },
  { value: '05', label: t('May', 'Mayo') },
  { value: '06', label: t('June', 'Junio') },
  { value: '07', label: t('July', 'Julio') },
  { value: '08', label: t('August', 'Agosto') },
  { value: '09', label: t('September', 'Septiembre') },
  { value: '10', label: t('October', 'Octubre') },
  { value: '11', label: t('November', 'Noviembre') },
  { value: '12', label: t('December', 'Diciembre') },
]

// 120 years back covers a birth date with room to spare; capped at this
// year rather than running into the future.
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 121 }, (_, i) => CURRENT_YEAR - i)

// Bounded to the actual days in the selected month/year (leap years
// included) once both are picked -- 31 while either is still unset, so the
// day list doesn't shrink out from under a day the patient already chose.
const daysInMonth = computed(() => {
  if (!year.value || !month.value) return 31
  return new Date(Number(year.value), Number(month.value), 0).getDate()
})
const DAYS = computed(() => Array.from({ length: daysInMonth.value }, (_, i) => String(i + 1).padStart(2, '0')))

watch(daysInMonth, (max) => {
  if (day.value && Number(day.value) > max) day.value = String(max).padStart(2, '0')
})

watch([day, month, year], ([d, m, y]) => {
  emit('update:modelValue', d && m && y ? `${y}-${m}-${d}` : null)
})
</script>

<template>
  <div class="mt-1 flex gap-1.5">
    <select
      v-model="day"
      class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    >
      <option value="" disabled>{{ t('Day', 'Día') }}</option>
      <option v-for="d in DAYS" :key="d" :value="d">{{ Number(d) }}</option>
    </select>
    <select
      v-model="month"
      class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    >
      <option value="" disabled>{{ t('Month', 'Mes') }}</option>
      <option v-for="m in MONTHS" :key="m.value" :value="m.value">{{ m.label }}</option>
    </select>
    <select
      v-model="year"
      class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    >
      <option value="" disabled>{{ t('Year', 'Año') }}</option>
      <option v-for="y in YEARS" :key="y" :value="String(y)">{{ y }}</option>
    </select>
  </div>
</template>
