<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()

const chiefComplaint = ref('')
const redFlags = ref('')
const yellowFlags = ref('')
const tags = ref<string[]>([])
const newTag = ref('')
const loading = ref(true)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patients')
    .select('chief_complaint, red_flags, yellow_flags, tags')
    .eq('id', props.patientId)
    .maybeSingle()
  chiefComplaint.value = data?.chief_complaint ?? ''
  redFlags.value = data?.red_flags ?? ''
  yellowFlags.value = data?.yellow_flags ?? ''
  tags.value = data?.tags ?? []
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

async function saveChiefComplaint() {
  await supabase.from('patients').update({ chief_complaint: chiefComplaint.value || null }).eq('id', props.patientId)
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
</script>

<template>
  <div v-if="!loading" class="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
    <h3 class="text-sm font-semibold text-gray-900">Flags</h3>

    <div>
      <label class="block text-xs font-medium text-gray-500">Chief Complaint</label>
      <textarea
        v-model="chiefComplaint"
        rows="2"
        placeholder="Enter patient's chief complaint here"
        class="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        @blur="saveChiefComplaint"
      ></textarea>
    </div>

    <div>
      <label class="block text-xs font-medium text-red-600">Red Flags</label>
      <textarea
        v-model="redFlags"
        rows="2"
        placeholder="Urgent findings requiring immediate attention"
        class="mt-0.5 w-full rounded-md border border-red-200 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        @blur="saveRedFlags"
      ></textarea>
    </div>

    <div>
      <label class="block text-xs font-medium text-amber-600">Yellow Flags</label>
      <textarea
        v-model="yellowFlags"
        rows="2"
        placeholder="Psychosocial or risk factors to keep in mind"
        class="mt-0.5 w-full rounded-md border border-amber-200 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        @blur="saveYellowFlags"
      ></textarea>
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500">Tags</label>
      <div class="mt-1 flex flex-wrap items-center gap-1.5">
        <span v-for="tag in tags" :key="tag" class="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
          {{ tag }}
          <button type="button" class="text-gray-400 hover:text-gray-600" @click="removeTag(tag)">✕</button>
        </span>
        <input
          v-model="newTag"
          type="text"
          placeholder="+ Add Tag"
          class="w-24 rounded border border-gray-200 px-2 py-0.5 text-xs focus:border-indigo-500 focus:outline-none"
          @keydown.enter.prevent="addTag"
          @blur="addTag"
        />
      </div>
    </div>
  </div>
</template>
