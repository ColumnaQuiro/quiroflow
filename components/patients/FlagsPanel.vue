<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()

const chiefComplaint = ref('')
const diagnosis = ref('')
const goals = ref('')
const redFlags = ref('')
const yellowFlags = ref('')
const tags = ref<string[]>([])
const newTag = ref('')
const loading = ref(true)
const editing = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patients')
    .select('chief_complaint, diagnosis, goals, red_flags, yellow_flags, tags')
    .eq('id', props.patientId)
    .maybeSingle()
  chiefComplaint.value = data?.chief_complaint ?? ''
  diagnosis.value = data?.diagnosis ?? ''
  goals.value = data?.goals ?? ''
  redFlags.value = data?.red_flags ?? ''
  yellowFlags.value = data?.yellow_flags ?? ''
  tags.value = data?.tags ?? []
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

async function saveChiefComplaint() {
  await supabase.from('patients').update({ chief_complaint: chiefComplaint.value || null }).eq('id', props.patientId)
}
async function saveDiagnosis() {
  await supabase.from('patients').update({ diagnosis: diagnosis.value || null }).eq('id', props.patientId)
}
async function saveGoals() {
  await supabase.from('patients').update({ goals: goals.value || null }).eq('id', props.patientId)
}
async function saveRedFlags() {
  await supabase.from('patients').update({ red_flags: redFlags.value || null }).eq('id', props.patientId)
}
async function saveYellowFlags() {
  await supabase.from('patients').update({ yellow_flags: yellowFlags.value || null }).eq('id', props.patientId)
}

async function addTag() {
  const tag = newTag.value.trim()
  if (!tag || tags.value.includes(tag)) {
    newTag.value = ''
    return
  }
  tags.value = [...tags.value, tag]
  newTag.value = ''
  await supabase.from('patients').update({ tags: tags.value }).eq('id', props.patientId)
}
async function removeTag(tag: string) {
  tags.value = tags.value.filter((t) => t !== tag)
  await supabase.from('patients').update({ tags: tags.value }).eq('id', props.patientId)
}

const flagRows = computed(() => {
  const rows: { text: string; dot: string }[] = []
  if (redFlags.value) rows.push({ text: redFlags.value, dot: 'bg-danger-text' })
  if (yellowFlags.value) rows.push({ text: yellowFlags.value, dot: 'bg-warning-accent' })
  if (chiefComplaint.value) rows.push({ text: chiefComplaint.value, dot: 'bg-ink-faint3' })
  if (diagnosis.value) rows.push({ text: diagnosis.value, dot: 'bg-ink-faint3' })
  if (goals.value) rows.push({ text: goals.value, dot: 'bg-ink-faint3' })
  return rows
})
</script>

<template>
  <div v-if="!loading" class="rounded-card border border-danger-border bg-danger-bg3 p-4 shadow-card">
    <div class="flex items-center justify-between gap-2">
      <p class="text-[13.5px] font-semibold text-ink-700">Flags</p>
      <button type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover" @click="editing = !editing">
        {{ editing ? 'Done' : 'Edit' }}
      </button>
    </div>

    <template v-if="!editing">
      <div v-if="flagRows.length > 0" class="mt-2.5 space-y-1.5">
        <div v-for="(row, i) in flagRows" :key="i" class="flex items-start gap-2">
          <span class="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full" :class="row.dot" />
          <p class="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] leading-snug text-ink-600">{{ row.text }}</p>
        </div>
      </div>
      <p v-else class="mt-2 text-[12.5px] text-ink-faint">No flags recorded.</p>

      <div v-if="tags.length > 0" class="mt-3 flex flex-wrap gap-1.5 border-t border-danger-border pt-2.5">
        <span v-for="tag in tags" :key="tag" class="rounded-pill bg-chip-bg px-2 py-0.5 text-[11px] font-medium text-chip-text">{{ tag }}</span>
      </div>
    </template>

    <template v-else>
      <div class="mt-3 space-y-2.5">
        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Chief complaint</label>
          <textarea
            v-model="chiefComplaint"
            rows="2"
            placeholder="Enter patient's chief complaint here"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
            @blur="saveChiefComplaint"
          ></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Diagnosis</label>
          <textarea
            v-model="diagnosis"
            rows="2"
            placeholder="Working diagnosis"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
            @blur="saveDiagnosis"
          ></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Goals</label>
          <textarea
            v-model="goals"
            rows="2"
            placeholder="Treatment goals"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
            @blur="saveGoals"
          ></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-medium text-danger-text">Red flags</label>
          <textarea
            v-model="redFlags"
            rows="2"
            placeholder="Urgent findings requiring immediate attention"
            class="mt-1 w-full rounded-ctl border border-danger-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700 focus:border-danger-text focus:outline-none"
            @blur="saveRedFlags"
          ></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-medium text-warning-accent">Yellow flags</label>
          <textarea
            v-model="yellowFlags"
            rows="2"
            placeholder="Psychosocial or risk factors to keep in mind"
            class="mt-1 w-full rounded-ctl border border-warning-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700 focus:border-warning-accent focus:outline-none"
            @blur="saveYellowFlags"
          ></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Tags</label>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span v-for="tag in tags" :key="tag" class="inline-flex items-center gap-1 rounded-pill bg-chip-bg px-2 py-0.5 text-[11px] font-medium text-chip-text">
              {{ tag }}
              <button type="button" class="text-ink-faint hover:text-ink-600" @click="removeTag(tag)">✕</button>
            </span>
            <input
              v-model="newTag"
              type="text"
              placeholder="+ Add tag"
              class="w-24 rounded-ctlSm border border-line-control bg-surface px-1.5 py-0.5 text-[11px] focus:border-brand focus:outline-none"
              @keydown.enter.prevent="addTag"
              @blur="addTag"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
