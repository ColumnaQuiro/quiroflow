<script setup lang="ts">
import { computePresetRange } from '~/composables/useDateRangePresets'
import { widgetDef, NEXT_SIZE } from '~/utils/dashboardWidgets'

const store = useAccountStore()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const { widgets, loaded, load: loadLayout, save, add, remove, setSize, reorder } = useDashboardLayout()

const editing = ref(false)
const showPicker = ref(false)
const practitionerFilter = ref('')
const clinicFilter = ref('')
const range = ref(computePresetRange({ months: 1 }))

onMounted(() => {
  loadLayout()
  loadFilterOptions()
})

const draggedIndex = ref<number | null>(null)
function onDragStart(index: number) {
  draggedIndex.value = index
}
function onDragOver(index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return
  reorder(draggedIndex.value, index)
  draggedIndex.value = index
}

async function toggleEditing() {
  if (editing.value) await save()
  editing.value = !editing.value
}

function onAddWidget(type: string) {
  add(type)
  showPicker.value = false
  save()
}

function onRemoveWidget(id: string) {
  remove(id)
  save()
}

function onCycleSize(id: string, currentSize: 'sm' | 'md' | 'lg') {
  setSize(id, NEXT_SIZE[currentSize])
  save()
}

const widgetProps = computed(() => ({
  dateRange: range.value,
  practitionerId: practitionerFilter.value || undefined,
  clinicId: clinicFilter.value || undefined,
}))
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">Good to see you, {{ store.teamMember?.full_name }}</h1>
        <p class="mt-1 text-sm text-gray-500">Here's what's happening across {{ store.accountName }}.</p>
      </div>
      <button
        type="button"
        class="rounded-md px-4 py-2 text-sm font-medium"
        :class="editing ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'"
        @click="toggleEditing"
      >
        {{ editing ? 'Done' : 'Edit Layout' }}
      </button>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <ReportsDateRangeSelect v-model="range" />
      <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
    </div>

    <div v-if="!loaded" class="mt-6 text-sm text-gray-400">Loading…</div>
    <div v-else class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
      <DashboardWidgetFrame
        v-for="(w, i) in widgets"
        :key="w.id"
        :title="widgetDef(w.type)?.label ?? w.type"
        :size="w.size"
        :editing="editing"
        :index="i"
        @remove="onRemoveWidget(w.id)"
        @cycle-size="onCycleSize(w.id, w.size)"
        @drag-start="onDragStart"
        @drag-over="onDragOver"
      >
        <component :is="widgetDef(w.type)?.component" v-bind="widgetProps" />
      </DashboardWidgetFrame>

      <button
        v-if="editing"
        type="button"
        class="col-span-1 flex min-h-[6rem] items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-sm font-medium text-gray-400 hover:border-indigo-300 hover:text-indigo-600"
        @click="showPicker = true"
      >
        + Add Widget
      </button>
    </div>

    <DashboardAddWidgetPicker
      v-if="showPicker"
      :existing-types="widgets.map((w) => w.type)"
      @add="onAddWidget"
      @close="showPicker = false"
    />
  </div>
</template>
