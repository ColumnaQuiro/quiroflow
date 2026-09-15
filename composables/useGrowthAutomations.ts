// The visual workflow builder, drawing the account's real automations.
//
// It used to draw fixtures -- seven invented workflows with invented run
// counts, one of them credited to a person who does not work here. The
// comment that stood here predicted the reconciliation this is: "the two
// will need reconciling when the schema lands, most likely by the flat rules
// becoming single-step workflows". The schema landed (rules now carry delays
// and run as sequences), so a workflow is now literally an automation_rule:
// its trigger, then its actions in order.
//
// Nothing branches, because nothing in the schema branches. Drawing a branch
// that cannot exist is exactly how the fixtures came to promise things the
// product could not do.
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

export interface NodeConfigField {
  label: string
  value: string
}

export interface SelectedNodeConfig {
  fields: NodeConfigField[]
  outputs: { label: string; count: string }[]
}

export const CANVAS_WIDTH = 672
export const CANVAS_HEIGHT = 660

export interface RealWorkflowStep {
  kind: WorkflowNodeKind
  title: string
  eyebrow?: string
  detail?: string | null
}

export interface RealWorkflow {
  id: string
  name: string
  enabled: boolean
  dryRun: boolean
  isMarketing: boolean
  triggerEvent: string
  runs: string
  steps: RealWorkflowStep[]
}

const NODE_WIDTH = 300
const NODE_HEIGHT = 74
const NODE_GAP = 38

/** A chain, laid out top to bottom down the middle of the canvas. */
function layout(steps: RealWorkflowStep[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes = steps.map((step, i) => ({
    id: String(i),
    kind: step.kind,
    title: step.title,
    eyebrow: step.eyebrow,
    detail: step.detail ?? undefined,
    x: CANVAS_WIDTH / 2,
    y: 24 + i * (NODE_HEIGHT + NODE_GAP),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }))
  const edges = nodes.slice(1).map((node, i) => ({ from: String(i), to: node.id }))
  return { nodes, edges }
}

export function useGrowthAutomations() {
  const workflows = ref<RealWorkflow[]>([])
  const activeWorkflowId = ref<string | null>(null)
  const nodes = ref<WorkflowNode[]>([])
  const edges = ref<WorkflowEdge[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  const selectedNodeId = ref('0')
  const t = useT()

  const activeWorkflow = computed(() => workflows.value.find((w) => w.id === activeWorkflowId.value) ?? null)

  function draw() {
    const steps = activeWorkflow.value?.steps ?? []
    const laid = layout(steps)
    nodes.value = laid.nodes
    edges.value = laid.edges
    selectedNodeId.value = '0'
  }

  async function load() {
    try {
      const result = await useStaffFetch<{ workflows: RealWorkflow[] }>('/api/growth/automations')
      workflows.value = result.workflows
      activeWorkflowId.value = result.workflows[0]?.id ?? null
      draw()
    } catch {
      error.value = t('Could not load automations.', 'No se han podido cargar las automatizaciones.')
    } finally {
      loading.value = false
    }
  }
  onMounted(load)

  function selectWorkflow(id: string) {
    activeWorkflowId.value = id
    draw()
  }

  const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)
  const selectedConfig = computed<SelectedNodeConfig | null>(() => {
    const node = selectedNode.value
    if (!node) return null
    return {
      fields: [
        { label: t('Step', 'Paso'), value: node.eyebrow ?? node.kind },
        { label: t('What it does', 'Qué hace'), value: node.title },
        ...(node.detail ? [{ label: t('Detail', 'Detalle'), value: node.detail }] : []),
      ],
      outputs: [],
    }
  })

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

  return {
    workflows,
    activeWorkflow,
    activeWorkflowId,
    selectWorkflow,
    nodes,
    edges,
    edgePaths,
    loading,
    error,
    selectedNode,
    selectedConfig,
    selectedNodeId,
    selectNode,
  }
}
