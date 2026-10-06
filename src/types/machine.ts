import type { Edge, Node } from '@xyflow/react'

export type StateKind = 'simple' | 'compound' | 'final'
export type ContextValue = string | number | boolean

export interface StateNodeData extends Record<string, unknown> {
  label: string
  kind: StateKind
  description: string
  initial: boolean
  isGroup?: boolean
  /** 并行支路 id：复合状态下同一 branchId 的子状态属于同一条支路 */
  branchId?: string
}

export type StateNode = Node<StateNodeData, 'state'>

export interface Assignment {
  variable: string
  expression: string
}

export interface TransitionData extends Record<string, unknown> {
  event: string
  condition: string
  action: string
  assignments: Assignment[]
}

export type TransitionEdge = Edge<TransitionData, 'transition'>

export interface ContextVariable {
  name: string
  type: 'number' | 'string' | 'boolean'
  initial: ContextValue
}

export interface TraceEntry {
  id: string
  event: string
  from: string
  to: string
  condition: string
  action: string
  contextAfter: Record<string, ContextValue>
  timestamp: string
  accepted: boolean
  reason?: string
  /** 命中多条转移且守卫排不出先后时为 true */
  conflict?: boolean
  /** 发生冲突时相互竞争的转移 id */
  conflictEdges?: string[]
  /** 该转移所属的并行支路 id */
  branchId?: string
}

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  id: string
  severity: IssueSeverity
  title: string
  detail: string
  nodeId?: string
  edgeId?: string
}

export interface MachineDocument {
  version: 1 | 2
  name: string
  nodes: StateNode[]
  edges: TransitionEdge[]
  variables: ContextVariable[]
  savedAt: string
}
