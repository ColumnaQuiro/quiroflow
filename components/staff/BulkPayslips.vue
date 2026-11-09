<script setup lang="ts">
import { guessStaffMember } from '../../utils/staffDocuments'

// Personal › Subir nóminas: the month's payslips for everyone at once. One
// month for all of them; each file goes to the person whose name it carries
// (guessStaffMember), or to whoever the owner picks when the name does not
// say. Nothing is uploaded until every file has someone.
const props = defineProps<{ accountId: string; members: { id: string; full_name: string }[] }>()
const emit = defineEmits<{ close: []; done: [count: number] }>()
const t = useT()
const { upload, announce, problemWith } = useStaffDocumentUpload()

function lastMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const month = ref(lastMonth())
// `error` is what is wrong with the file itself (blocks the upload);
// `failed`, why its upload did not go through (it can be tried again).
const rows = ref<{ file: File; member: string; state: 'waiting' | 'done' | 'failed'; error: string; failed: string }[]>([])
function picked(e: Event) {
  rows.value = [...((e.target as HTMLInputElement).files ?? [])].map((file) => ({ file, member: guessStaffMember(file.name, props.members)?.id ?? '', state: 'waiting', error: problemWith(file), failed: '' }))
}
const problem = computed(() => {
  if (!month.value) return t('Choose the month.', 'Elige el mes.')
  if (!rows.value.length) return t('Choose the payslips.', 'Elige las nóminas.')
  if (rows.value.some((r) => r.error)) return rows.value.find((r) => r.error)!.error
  if (rows.value.some((r) => !r.member)) return t('Choose who each payslip is for.', 'Elige de quién es cada nómina.')
  return ''
})
const saving = ref(false)
async function save() {
  if (problem.value) return
  saving.value = true
  const ids: string[] = []
  for (const r of rows.value) {
    if (r.state === 'done') continue
    try {
      ids.push(await upload({ accountId: props.accountId, teamMemberId: r.member, file: r.file, category: 'payslip', month: month.value }))
      r.state = 'done'
    } catch (e: any) {
      r.state = 'failed'
      r.failed = e?.message ?? t("Couldn't upload it.", 'No se ha podido subir.')
    }
  }
  saving.value = false
  await announce(ids)
  if (rows.value.every((r) => r.state === 'done')) emit('done', ids.length)
}
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <form class="flex flex-col gap-4 rounded-card border border-line bg-surface px-4 py-4" data-cy="bulk-payslips" @submit.prevent="save">
    <div>
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Upload payslips', 'Subir nóminas') }}</h2>
      <p class="text-[12.5px] text-ink-muted">{{ t('One PDF per person. Each goes to whoever its file name names; choose for any it cannot tell. Each person gets a notification.', 'Un PDF por persona. Cada uno va a quien nombra su archivo; elige tú en los que no lo diga. Cada persona recibe un aviso.') }}</p>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
        {{ t('Month', 'Mes') }}
        <input v-model="month" type="month" :class="inputClass" data-cy="bulk-payslips-month" />
      </label>
      <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
        {{ t('Payslips (PDF)', 'Nóminas (PDF)') }}
        <input type="file" multiple accept="application/pdf" class="text-[13px] font-normal" data-cy="bulk-payslips-files" @change="picked" />
      </label>
    </div>
    <ul v-if="rows.length" class="flex flex-col divide-y divide-line-row rounded-ctl border border-line">
      <li v-for="(r, i) in rows" :key="i" class="flex flex-wrap items-center gap-3 px-3 py-2" data-cy="bulk-payslips-row">
        <span class="min-w-[10rem] flex-1 truncate text-[13px] text-ink-900" :title="r.file.name">{{ r.file.name }}</span>
        <select v-model="r.member" :class="inputClass" :disabled="r.state === 'done'" :aria-label="t(`Who ${r.file.name} is for`, `De quién es ${r.file.name}`)" data-cy="bulk-payslips-member">
          <option value="" disabled>{{ t('Who is it for?', '¿De quién es?') }}</option>
          <option v-for="m in members" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        </select>
        <span v-if="r.state === 'done'" class="text-[12.5px] font-semibold text-success-text">{{ t('Uploaded', 'Subida') }}</span>
        <span v-else-if="r.error || r.failed" class="w-full text-[12.5px] text-danger-text">{{ r.error || r.failed }}</span>
      </li>
    </ul>
    <p v-if="problem && rows.length" role="alert" class="text-[13px] text-danger-text">{{ problem }}</p>
    <div class="flex gap-2">
      <UiBtn variant="primary" type="submit" :disabled="saving || !!problem" data-cy="bulk-payslips-save">{{ saving ? t('Uploading…', 'Subiendo…') : t(`Upload ${rows.length || ''}`.trim(), `Subir ${rows.length || ''}`.trim()) }}</UiBtn>
      <UiBtn variant="ghost" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
    </div>
  </form>
</template>
