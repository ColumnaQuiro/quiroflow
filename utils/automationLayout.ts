// Where every node of an automation sits on the builder's canvas.
//
// Computed from the tree (parent_id / branch / position), never stored: a
// step added, removed or moved re-lays the whole thing, and the connectors
// are derived from the node boxes rather than drawn by hand -- the lesson of
// the old Growth canvas, whose arrows were literal coordinates.
//
// Top to bottom. A chain is a column; a step with two outlets (an if/else, a
// wait-until) splits into two columns side by side under it, left for the
// happy path (yes / met), right for the other. A column is as wide as the
// widest split anywhere inside it. Every chain ends in an "End" node, and
// there is a "+" wherever a step can go: between two steps, before the end of
// a chain, at the top of an empty outlet.

import { OUTLETS } from './automationCatalog'
import { chainOf, type DraftStep } from './automationTree'

export const NODE_W = 272
export const NODE_H = 100
export const END_W = 132
export const END_H = 40
/** Vertical room between two nodes of a chain, where the "+" sits. */
export const GAP = 52
/** Vertical room under a splitting step: the fork and its two labels. */
export const SPLIT = 84
const COL_GAP = 48
const MARGIN = 48

export interface LaidNode {
  id: string
  kind: 'trigger' | 'step' | 'end'
  x: number
  y: number
  w: number
  h: number
  /** For an end node: the chain it ends. */
  chain?: { parentId: string | null; branch: string | null }
}

export interface InsertPoint {
  /** Where the "+" is drawn (its centre). */
  x: number
  y: number
  parentId: string | null
  branch: string | null
  /** The position the new step takes in that chain. */
  index: number
  /** The step before it (or null: the trigger / the fork) and after it (or null: the end). */
  afterId: string | null
  beforeId: string | null
}

export interface OutletLabel {
  parentId: string
  branch: string
  x: number
  y: number
}

export interface Layout {
  nodes: LaidNode[]
  edges: { id: string; d: string }[]
  inserts: InsertPoint[]
  labels: OutletLabel[]
  width: number
  height: number
}

export function layoutTree(steps: DraftStep[]): Layout {
  const widthCache = new Map<string, number>()
  const chainKey = (p: string | null, b: string | null) => `${p ?? ''}|${b ?? ''}`

  function chainWidth(parentId: string | null, branch: string | null): number {
    const key = chainKey(parentId, branch)
    if (widthCache.has(key)) return widthCache.get(key)!
    let w = NODE_W
    for (const step of chainOf(steps, parentId, branch)) {
      const outlets = OUTLETS[step.action_type]
      if (outlets) w = Math.max(w, chainWidth(step.id, outlets[0]) + COL_GAP + chainWidth(step.id, outlets[1]))
    }
    widthCache.set(key, w)
    return w
  }

  const nodes: LaidNode[] = []
  const edges: { id: string; d: string }[] = []
  const inserts: InsertPoint[] = []
  const labels: OutletLabel[] = []
  let maxY = 0

  const vline = (id: string, x: number, y1: number, y2: number) => edges.push({ id, d: `M${x},${y1} V${y2}` })

  /**
   * Lays one chain whose column is centred on `cx`, starting at `y` -- the top
   * edge of the gap above its first step (the fork line or the node above
   * already reach down to it). `afterId` is what comes before the chain.
   */
  function place(parentId: string | null, branch: string | null, cx: number, y: number, afterId: string | null) {
    const chain = chainOf(steps, parentId, branch)
    let prev = afterId
    let top = y
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i]!
      // The gap above this step, with its "+".
      inserts.push({ x: cx, y: top + GAP / 2, parentId, branch, index: i, afterId: prev, beforeId: step.id })
      vline(`in-${step.id}`, cx, top, top + GAP)
      const nodeY = top + GAP
      nodes.push({ id: step.id, kind: 'step', x: cx - NODE_W / 2, y: nodeY, w: NODE_W, h: NODE_H })
      const bottom = nodeY + NODE_H
      maxY = Math.max(maxY, bottom)

      const outlets = OUTLETS[step.action_type]
      if (outlets) {
        // Nothing follows a splitting step in its own chain (the engine ends
        // the run where the outlet's chain ends), so the chain stops here.
        const lw = chainWidth(step.id, outlets[0])
        const rw = chainWidth(step.id, outlets[1])
        const total = lw + COL_GAP + rw
        const lx = cx - total / 2 + lw / 2
        const rx = cx + total / 2 - rw / 2
        const forkY = bottom + SPLIT / 2
        edges.push({ id: `fork-${step.id}`, d: `M${cx},${bottom} V${forkY} M${lx},${forkY} H${rx} M${lx},${forkY} V${bottom + SPLIT} M${rx},${forkY} V${bottom + SPLIT}` })
        labels.push({ parentId: step.id, branch: outlets[0], x: lx, y: forkY })
        labels.push({ parentId: step.id, branch: outlets[1], x: rx, y: forkY })
        place(step.id, outlets[0], lx, bottom + SPLIT, null)
        place(step.id, outlets[1], rx, bottom + SPLIT, null)
        return
      }
      prev = step.id
      top = bottom
    }
    // The end of the chain, with the "+" that appends to it.
    inserts.push({ x: cx, y: top + GAP / 2, parentId, branch, index: chain.length, afterId: prev, beforeId: null })
    vline(`end-in-${chainKey(parentId, branch)}`, cx, top, top + GAP)
    const endY = top + GAP
    nodes.push({ id: `end:${chainKey(parentId, branch)}`, kind: 'end', x: cx - END_W / 2, y: endY, w: END_W, h: END_H, chain: { parentId, branch } })
    maxY = Math.max(maxY, endY + END_H)
  }

  const width = chainWidth(null, null) + MARGIN * 2
  const cx = width / 2
  nodes.push({ id: 'trigger', kind: 'trigger', x: cx - NODE_W / 2, y: MARGIN, w: NODE_W, h: NODE_H })
  place(null, null, cx, MARGIN + NODE_H, null)

  return { nodes, edges, inserts, labels, width, height: maxY + MARGIN }
}
