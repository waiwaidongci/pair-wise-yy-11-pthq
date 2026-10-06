import type { Edge, Node } from '@xyflow/react'

export type StateKind = 'simple' | 'compound' | 'final'
export type ContextValue = string | number | boolean

export interface ParallelBranch {
  id: string
  label: string
}

export interface StateNodeData extends Record<string, unknown> {
  label: string
  kind: StateKind
  description: string
  initial: boolean
  isGroup?: boolean
  /** 复合状态是否按多条并行支路运行（旧单支路数据迁移后为 true，仅含一条支路） */
  parallel?: boolean
  /** 并行支路定义；普通状态与结束状态不使用 */
  branches?: ParallelBranch[]
  /** 子状态所属支路 id（单支路复合状态可不填） */
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
  /** 守卫优先级，数值越大越优先；默认守卫 1、空守卫 0 */
  priority?: number
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
  /** 命中的支路 id；整体完成/忽略事件时为空 */
  branchId?: string
  /** 支路名称，用于轨迹展示 */
  branchLabel?: string
  condition: string
  action: string
  contextAfter: Record<string, ContextValue>
  timestamp: string
  accepted: boolean
  /** 同一支路上多条转移守卫优先级相同、无法排出先后 */
  conflict?: boolean
  reason?: string
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
  version: 2
  name: string
  nodes: StateNode[]
  edges: TransitionEdge[]
  variables: ContextVariable[]
  savedAt: string
}

/** 磁盘上可能存在的旧版本文档（version 1：复合状态只有一条串行支路） */
export type MachineDocumentLike = Omit<MachineDocument, 'version'> & { version?: number }
