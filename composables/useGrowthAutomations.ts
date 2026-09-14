// The visual workflow builder: a list of workflows, a library of chiro
// templates, and one fully built flow on the canvas.
//
// Not to be confused with composables/useAutomations.ts, which fires the
// existing Campaigns rules. Those are flat trigger -> action pairs stored in
// automation_rules. A Growth workflow is a graph: delays, a condition with
// two labelled outputs, and branches that rejoin. The builder is the editor
// for that richer shape, and the two will need reconciling when the schema
// lands -- most likely by the flat rules becoming single-step workflows.
//
// Node positions are data, and the connectors between them are *computed*
// from node geometry rather than stored. The artboard draws its arrows as
// hand-written SVG paths with literal coordinates, which is fine for a
// picture and wrong for an editor: moving a node would leave the arrow
// pointing at where it used to be.

export type WorkflowNodeKind = 'trigger' | 'message' | 'delay' | 'condition' | 'ai' | 'internal' | 'terminal'

export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  title: string
  /** Small label above the title -- "Message · WhatsApp". */
  eyebrow?: string
  detail?: string
  badge?: string
  /** Centre-x and top-y in canvas units. */
  x: number
  y: number
  width: number
  height: number
  /** Condition nodes only: the labelled branches leaving the node. */
  outputs?: { label: string; share: string }[]
}

export interface WorkflowEdge {
  from: string
  to: string
  /** Drawn dashed where the branch is a fallback rather than the happy path. */
  dashed?: boolean
}

export interface Workflow {
  id: string
  name: string
  runs: string
  enabled: boolean
}

export interface WorkflowTemplate {
  name: string
  note: string
}

export interface NodeConfigField {
  label: string
  value: string
}

export interface SelectedNodeConfig {
  fields: NodeConfigField[]
  outputs: { label: string; count: string }[]
}

export const WORKFLOWS: Workflow[] = [
  { id: 'meta-speed', name: 'Meta Ads · speed to lead', runs: '412 runs · 30d', enabled: true },
  { id: 'missed-call', name: 'Missed-call text back', runs: '96 runs · 30d', enabled: true },
  { id: 'no-show', name: 'No-show rescue', runs: '27 runs · 30d', enabled: true },
  { id: 'google-call', name: 'Google Ads · call qualification', runs: '188 runs · 30d', enabled: true },
  { id: 'dormant', name: 'Dormant patient reactivation', runs: '0 runs · paused', enabled: false },
  { id: 'review', name: 'Post-visit review request', runs: '143 runs · 30d', enabled: true },
  { id: 'renewal', name: 'Care plan renewal nudge', runs: '0 runs · draft', enabled: false },
]

export const TEMPLATES: WorkflowTemplate[] = [
  { name: 'Missed-call text back', note: 'Texts within 30s of a missed call' },
  { name: 'No-show rescue', note: 'Rebooks within 2 h of a no-show' },
  { name: 'Dormant patient reactivation', note: 'No visit in 120 days' },
  { name: 'Post-visit review request', note: 'Asks 3 h after a completed visit' },
]

// Laid out in a 672-wide canvas: one trunk down the middle, splitting at the
// condition into a left (no) and right (yes) branch that rejoin at the end.
const NODES: WorkflowNode[] = [
  { id: 'trigger', kind: 'trigger', x: 336, y: 8, width: 260, height: 64, eyebrow: 'Trigger', title: 'New lead from Meta Ads form', detail: 'ES · Back pain · Sants 5km · 412 runs' },
  { id: 'wa', kind: 'message', x: 336, y: 106, width: 300, height: 70, eyebrow: 'Message · WhatsApp', title: 'Send WhatsApp within 60s', detail: '"Hola [first name], soy Alba de Clínica Sants…"', badge: '98% delivered' },
  { id: 'wait10', kind: 'delay', x: 336, y: 206, width: 150, height: 34, title: 'Wait 10 minutes' },
  {
    id: 'replied',
    kind: 'condition',
    x: 336,
    y: 268,
    width: 220,
    height: 82,
    eyebrow: 'Condition',
    title: 'Replied?',
    outputs: [
      { label: 'Yes', share: '61%' },
      { label: 'No', share: '39%' },
    ],
  },
  { id: 'ai-books', kind: 'ai', x: 500, y: 404, width: 240, height: 70, eyebrow: 'AI action', title: 'AI qualifies and books', detail: 'Alba · Initial Assessment · 14-day window' },
  { id: 'sms', kind: 'message', x: 172, y: 404, width: 240, height: 70, eyebrow: 'Message · SMS', title: 'Send SMS', detail: '"¿Te llamamos? Responde SÍ y te damos hueco hoy."' },
  { id: 'wait1d', kind: 'delay', x: 172, y: 502, width: 130, height: 34, title: 'Wait 1 day' },
  { id: 'notify', kind: 'internal', x: 172, y: 564, width: 240, height: 70, eyebrow: 'Internal action', title: 'Notify front desk', detail: 'Task for Nerea · "Call this lead today"' },
  { id: 'end', kind: 'terminal', x: 500, y: 564, width: 200, height: 34, title: 'Ends · lead is booked' },
]

const EDGES: WorkflowEdge[] = [
  { from: 'trigger', to: 'wa' },
  { from: 'wa', to: 'wait10' },
  { from: 'wait10', to: 'replied' },
  { from: 'replied', to: 'ai-books' },
  { from: 'replied', to: 'sms', dashed: true },
  { from: 'ai-books', to: 'end' },
  { from: 'sms', to: 'wait1d' },
  { from: 'wait1d', to: 'notify' },
]

const NODE_CONFIG: Record<string, SelectedNodeConfig> = {
  replied: {
    fields: [
      { label: 'Check', value: 'Lead replied on any channel' },
      { label: 'Within', value: '10 minutes' },
    ],
    outputs: [
      { label: 'Yes → AI qualifies and books', count: '251' },
      { label: 'No → Send SMS', count: '161' },
    ],
  },
}

export const CANVAS_WIDTH = 672
export const CANVAS_HEIGHT = 660

export function useGrowthAutomations() {
  const nodes = ref<WorkflowNode[]>([])
  const edges = ref<WorkflowEdge[]>([])
  const loading = ref(true)
  const selectedNodeId = ref('replied')

  onMounted(() => {
    nodes.value = structuredClone(NODES)
    edges.value = structuredClone(EDGES)
    loading.value = false
  })

  const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)
  const selectedConfig = computed<SelectedNodeConfig | null>(() => NODE_CONFIG[selectedNodeId.value] ?? null)

  /**
   * One elbow path per edge, derived from where the nodes actually are.
   * Straight down when the two share a centre; otherwise down to the midpoint,
   * across, and down into the target's top edge.
   */
  const edgePaths = computed(() =>
    edges.value.flatMap((edge) => {
      const from = nodes.value.find((n) => n.id === edge.from)
      const to = nodes.value.find((n) => n.id === edge.to)
      if (!from || !to) return []
      const startY = from.y + from.height
      const endY = to.y
      const d = from.x === to.x
        ? `M${from.x},${startY} V${endY}`
        : `M${from.x},${startY} V${(startY + endY) / 2} H${to.x} V${endY}`
      return [{ id: `${edge.from}-${edge.to}`, d, dashed: edge.dashed ?? false }]
    }),
  )

  function selectNode(id: string) {
    selectedNodeId.value = id
  }

  return { nodes, edges, edgePaths, loading, selectedNode, selectedConfig, selectedNodeId, selectNode }
}
