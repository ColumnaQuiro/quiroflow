<script setup lang="ts">
import type { KnowledgeCard, ReceptionistConfig } from '~/composables/useGrowthReceptionist'

// The facts the receptionist repeats to patients that are not in the
// settings: prices, the address and the hours are read from there
// (utils/receptionistTypes.ts, utils/receptionistClinic.ts). Each card is
// one topic (what you treat, the first visit, parking) with a line per
// fact; editable in place, because "remove the card and type it all again"
// is how a clinic ends up with a receptionist repeating last year's.
const props = defineProps<{
  config: ReceptionistConfig
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()

const newTitle = ref('')
const newLines = ref('')
const editingId = ref<string | null>(null)
const editTitle = ref('')
const editLines = ref('')

const toLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

// Where a clinic starts: the cards every clinic needs and only it can fill
// in. The rest -- what to do when the link fails, a voice note, worsening
// symptoms -- every receptionist already knows (utils/receptionistBaseRules.ts).
// A blank (___) has to be filled before the card can be saved: the model
// repeats a card as fact, blanks included.
const BLANK = '___'
const templates = computed(() => [
  { title: t('What we treat', 'Qué tratamos'), lines: [t('We mostly see ___ (for example back pain, neck pain, sciatica, headaches).', 'Atendemos sobre todo ___ (por ejemplo dolor de espalda, cuello, ciática, dolores de cabeza).'), t('We do not do ___ (for example massage or physiotherapy).', 'No hacemos ___ (por ejemplo masajes ni fisioterapia).')] },
  { title: t('The first visit', 'La primera visita'), lines: [t('It includes ___ (history, posture tests, the first adjustment...).', 'Incluye ___ (historial, pruebas posturales, el primer ajuste...).'), t('It lasts about ___ minutes.', 'Dura unos ___ minutos.')] },
  { title: t('Payment and insurance', 'Pagos y seguros'), lines: [t('You can pay by ___ (card, cash, transfer, Bizum).', 'Se puede pagar con ___ (tarjeta, efectivo, transferencia, Bizum).'), t('With insurers: ___ (for example we do not work with them directly, but give you an invoice to claim).', 'Con las aseguradoras: ___ (por ejemplo no trabajamos directamente con ellas, pero te damos factura para reclamar).')] },
  { title: t('What to bring', 'Qué traer'), lines: [t('Wear comfortable clothes you can move in.', 'Ven con ropa cómoda que te permita moverte.'), t('If you have recent reports or scans, bring them.', 'Si tienes informes o pruebas recientes, tráelos.')] },
  { title: t('Running late', 'Si llegas tarde'), lines: [t('If you are more than ___ minutes late, ___.', 'Si llegas más de ___ minutos tarde, ___.')] },
  { title: t('Children and pregnancy', 'Niños y embarazadas'), lines: [t('We see children from ___ and pregnant women ___.', 'Atendemos a niños desde ___ y a embarazadas ___.')] },
].filter((template) => !props.config.knowledge.some((card) => card.title.trim().toLowerCase() === template.title.toLowerCase())))

function useTemplate(template: { title: string; lines: string[] }) {
  newTitle.value = template.title
  newLines.value = template.lines.join('\n')
}

const newHasBlank = computed(() => newLines.value.includes(BLANK) || newTitle.value.includes(BLANK))
const editHasBlank = computed(() => editLines.value.includes(BLANK) || editTitle.value.includes(BLANK))

function add() {
  const title = newTitle.value.trim()
  if (!title || newHasBlank.value) return
  props.save({
    knowledge: [
      ...props.config.knowledge,
      // A stable id so Vue's keys and any later edit refer to the same card
      // rather than to whatever is currently in that position.
      { id: crypto.randomUUID(), title: title.slice(0, 120), lines: toLines(newLines.value) },
    ],
  })
  newTitle.value = ''
  newLines.value = ''
}

function startEdit(card: KnowledgeCard) {
  editingId.value = card.id
  editTitle.value = card.title
  editLines.value = card.lines.join('\n')
}

async function commitEdit() {
  const id = editingId.value
  const title = editTitle.value.trim()
  if (!id || !title || editHasBlank.value) return
  const ok = await props.save({
    knowledge: props.config.knowledge.map((card) => (card.id === id ? { ...card, title: title.slice(0, 120), lines: toLines(editLines.value) } : card)),
  })
  if (ok) editingId.value = null
}

function remove(id: string) {
  props.save({ knowledge: props.config.knowledge.filter((c) => c.id !== id) })
}

const inputClass = 'h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none'
const areaClass = 'resize-none rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[12px] leading-[1.5] text-ink-700 focus:border-brand focus:outline-none'
</script>

<template>
  <GrowthSettingCard :title="t('Clinic knowledge', 'Lo que sabe de la clínica')">
    <p v-if="!config.knowledge.length" class="text-[11.5px] leading-[1.5] text-ink-muted" data-test="knowledge-empty">
      {{ t(
        'Nothing yet. Prices, the address and the hours come from your settings; for anything else -- what you treat, what the first visit includes -- the receptionist says it will check with a colleague rather than guessing.',
        'Nada todavía. Los precios, la dirección y el horario los saca de Ajustes; para todo lo demás (qué tratáis, qué incluye la primera visita), la recepcionista dirá que lo consultará con un compañero en lugar de inventar.',
      ) }}
    </p>

    <div v-for="card in config.knowledge" :key="card.id" class="flex flex-col gap-1 rounded-ctl border border-line bg-surface-subtle p-3" data-test="knowledge-card">
      <template v-if="editingId === card.id">
        <input v-model="editTitle" type="text" :class="inputClass" :aria-label="t('Title', 'Título')" data-test="edit-card-title">
        <textarea v-model="editLines" rows="4" :class="areaClass" :aria-label="t('Facts, one per line', 'Datos, uno por línea')" data-test="edit-card-lines" />
        <p v-if="editHasBlank" class="text-[11px] leading-[1.5] text-warning-text">{{ t('Fill in every ___ before saving.', 'Rellena cada ___ antes de guardar.') }}</p>
        <div class="flex items-center gap-2">
          <UiBtn variant="primary" size="sm" :disabled="saving || !editTitle.trim() || editHasBlank" data-test="edit-card-save" @click="commitEdit">{{ t('Save', 'Guardar') }}</UiBtn>
          <UiBtn variant="ghost" size="sm" :disabled="saving" @click="editingId = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </div>
      </template>
      <template v-else>
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-[11.5px] font-semibold text-ink-900">{{ card.title }}</span>
          <span class="flex shrink-0 items-center gap-2">
            <button type="button" class="text-[11px] font-medium text-brand-text hover:underline" :disabled="saving" :data-test="`edit-card-${card.id}`" @click="startEdit(card)">{{ t('Edit', 'Editar') }}</button>
            <button type="button" class="text-[11px] font-medium text-danger-text hover:underline" :disabled="saving" :data-test="`remove-card-${card.id}`" @click="remove(card.id)">{{ t('Remove', 'Quitar') }}</button>
          </span>
        </div>
        <span v-for="line in card.lines" :key="line" class="text-[11px] text-ink-muted">{{ line }}</span>
      </template>
    </div>

    <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
      <div v-if="templates.length" class="flex flex-wrap items-center gap-1.5" data-test="card-templates">
        <span class="text-[11px] text-ink-muted">{{ t('Start from:', 'Empieza por:') }}</span>
        <button
          v-for="template in templates"
          :key="template.title"
          type="button"
          class="rounded-pill border border-line-control bg-surface px-2.5 py-0.5 text-[11px] font-medium text-ink-700 hover:border-brand hover:text-brand-text"
          :data-test="`card-template-${template.title}`"
          @click="useTemplate(template)"
        >
          {{ template.title }}
        </button>
      </div>
      <input
        v-model="newTitle"
        type="text"
        :placeholder="t('What it is about — e.g. What we treat, The first visit, Parking', 'De qué trata — p. ej. Qué tratamos, La primera visita, Parking')"
        :class="inputClass"
        data-test="card-title"
      />
      <textarea
        v-model="newLines"
        rows="3"
        :placeholder="t('One fact per line. It lasts about an hour\nWear comfortable clothes', 'Un dato por línea. Dura cerca de una hora\nVen con ropa cómoda')"
        :class="areaClass"
        data-test="card-lines"
      />
      <p v-if="newHasBlank" class="text-[11px] leading-[1.5] text-warning-text" data-test="card-blank">
        {{ t('Fill in every ___ before adding it.', 'Rellena cada ___ antes de añadirla.') }}
      </p>
      <UiBtn variant="secondary" size="sm" class="self-start" :disabled="saving || !newTitle.trim() || newHasBlank" data-test="add-card" @click="add">
        {{ t('Add card', 'Añadir tarjeta') }}
      </UiBtn>
      <!-- The model is told these are the clinic's own facts, so a wrong one
      is repeated confidently to a patient rather than hedged. Worth saying
      where it is typed. -->
      <p class="text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          'The receptionist treats these as fact and repeats them to patients. Anything not here, it says it will check.',
          'La recepcionista trata esto como un hecho y se lo repite a los pacientes. Lo que no esté aquí, dirá que lo consultará.',
        ) }}
      </p>
    </div>
  </GrowthSettingCard>
</template>
