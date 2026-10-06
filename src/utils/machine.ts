import { createMachine } from 'xstate'
import type { ContextValue, MachineDocument, StateNode, StateNodeData, TraceEntry, TransitionEdge, ValidationIssue } from '../types/machine'

export function sendEventId() {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function stateId(prefix = 'state') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createState(label: string, position: { x: number; y: number }, kind: StateNode['data']['kind'] = 'simple', parentId?: string): StateNode {
  const node: StateNode = {
    id: stateId(kind),
    type: 'state',
    position,
    data: { label, kind, description: '', initial: false, isGroup: kind === 'compound' },
  }
  if (parentId) {
    node.parentId = parentId
    node.extent = 'parent'
    node.expandParent = true
  }
  if (kind === 'compound') {
    node.style = { width: 460, height: 310 }
    node.zIndex = 0
  }
  return node
}

export function sampleMachine(): { nodes: StateNode[]; edges: TransitionEdge[]; variables: MachineDocument['variables'] } {
  const idle = createState('待提交', { x: 60, y: 110 })
  idle.id = 'idle'
  idle.data.initial = true
  idle.data.description = '等待用户提交业务申请'

  const validating = createState('自动校验', { x: 320, y: 110 })
  validating.id = 'validating'
  validating.data.description = '验证资料完整性和额度'

  const manual = createState('人工审核', { x: 590, y: 70 })
  manual.id = 'manual'
  manual.data.description = '风控专员复核申请'

  const approved = createState('已通过', { x: 880, y: 70 }, 'final')
  approved.id = 'approved'

  const rejected = createState('已驳回', { x: 590, y: 250 }, 'final')
  rejected.id = 'rejected'

  const draft = createState('草稿补充', { x: 60, y: 300 })
  draft.id = 'draft'

  const edges: TransitionEdge[] = [
    { id: 't1', source: 'idle', target: 'validating', type: 'transition', data: { event: 'SUBMIT', condition: '', action: '记录提交时间', assignments: [{ variable: 'submitCount', expression: 'submitCount + 1' }] } },
    { id: 't2', source: 'validating', target: 'manual', type: 'transition', data: { event: 'VALID', condition: 'amount > 5000', action: '分配人工审核', assignments: [] } },
    { id: 't3', source: 'validating', target: 'approved', type: 'transition', data: { event: 'VALID', condition: 'amount <= 5000', action: '自动审批通过', assignments: [] } },
    { id: 't4', source: 'validating', target: 'rejected', type: 'transition', data: { event: 'INVALID', condition: '', action: '记录驳回原因', assignments: [{ variable: 'rejectCount', expression: 'rejectCount + 1' }] } },
    { id: 't5', source: 'manual', target: 'approved', type: 'transition', data: { event: 'APPROVE', condition: '', action: '审核通过', assignments: [] } },
    { id: 't6', source: 'manual', target: 'rejected', type: 'transition', data: { event: 'REJECT', condition: '', action: '审核驳回', assignments: [] } },
    { id: 't7', source: 'rejected', target: 'draft', type: 'transition', data: { event: 'REVISE', condition: '', action: '进入补充资料', assignments: [] } },
  ]
  return {
    nodes: [idle, validating, manual, approved, rejected, draft],
    edges,
    variables: [
      { name: 'amount', type: 'number', initial: 8000 },
      { name: 'submitCount', type: 'number', initial: 0 },
      { name: 'rejectCount', type: 'number', initial: 0 },
      { name: 'riskLevel', type: 'string', initial: 'normal' },
    ],
  }
}

export function resolveValue(expression: string, context: Record<string, ContextValue>): ContextValue {
  const trimmed = expression.trim()
  if (/^".*"$|^'.*'$/.test(trimmed)) return trimmed.slice(1, -1)
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true'
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed in context) return context[trimmed]
  const arithmetic = /^([A-Za-z_]\w*|\d+(?:\.\d+)?)\s*([+\-*/])\s*([A-Za-z_]\w*|\d+(?:\.\d+)?)$/.exec(trimmed)
  if (arithmetic) {
    const read = (value: string) => value in context ? Number(context[value]) : Number(value)
    const left = read(arithmetic[1])
    const right = read(arithmetic[3])
    if (arithmetic[2] === '+') return left + right
    if (arithmetic[2] === '-') return left - right
    if (arithmetic[2] === '*') return left * right
    if (arithmetic[2] === '/') return right === 0 ? 0 : left / right
  }
  return trimmed
}

function compare(left: ContextValue, operator: string, right: ContextValue): boolean {
  if (operator === '==' || operator === '===') return String(left) === String(right)
  if (operator === '!=' || operator === '!==') return String(left) !== String(right)
  const a = Number(left)
  const b = Number(right)
  if (operator === '>') return a > b
  if (operator === '<') return a < b
  if (operator === '>=') return a >= b
  if (operator === '<=') return a <= b
  return false
}

export function evaluateCondition(condition: string, context: Record<string, ContextValue>) {
  if (!condition.trim()) return true
  return condition.split(/\|\|/).some((orPart) => orPart.split(/&&/).every((part) => {
    const match = /^\s*([A-Za-z_]\w*|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)\s*(>=|<=|==|!=|>|<)\s*([A-Za-z_]\w*|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)\s*$/.exec(part)
    if (!match) return Boolean(resolveValue(part, context))
    return compare(resolveValue(match[1], context), match[2], resolveValue(match[3], context))
  }))
}

/** 生成并行支路 id */
export function branchId() {
  return `branch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 取子状态所属支路 id（兼容旧数据：无 branchId 时归入 default） */
export function branchIdOf(node: StateNode | StateNodeData): string {
  const data = ('data' in node ? node.data : node) as StateNodeData
  return data.branchId ?? 'default'
}

/** 判断节点是否为复合状态下的子状态 */
export function isChildNode(node: StateNode): boolean {
  return Boolean(node.parentId)
}

/** 找节点的父复合状态 id */
export function compoundParentId(node: StateNode, nodes: StateNode[]): string | null {
  if (!node.parentId) return null
  const parent = nodes.find((item) => item.id === node.parentId && item.data.kind === 'compound')
  return parent ? parent.id : null
}

/** 将复合状态的子状态按支路分组，保持插入顺序 */
export function getBranches(nodes: StateNode[], compoundId: string): Array<{ branchId: string; nodes: StateNode[] }> {
  const children = nodes.filter((node) => node.parentId === compoundId)
  const order: string[] = []
  const map = new Map<string, StateNode[]>()
  children.forEach((child) => {
    const bid = branchIdOf(child)
    if (!map.has(bid)) {
      map.set(bid, [])
      order.push(bid)
    }
    map.get(bid)!.push(child)
  })
  return order.map((bid) => ({ branchId: bid, nodes: map.get(bid)! }))
}

/** 支路是否已到达结束（当前激活子状态为 final） */
export function isBranchDone(nodes: StateNode[], branchNodes: StateNode[], active: Set<string>): boolean {
  return branchNodes.some((node) => active.has(node.id) && node.data.kind === 'final')
}

/** 复合状态的所有支路是否都已结束 */
export function isCompoundDone(nodes: StateNode[], compoundId: string, active: Set<string>): boolean {
  const branches = getBranches(nodes, compoundId)
  if (!branches.length) return false
  return branches.every((branch) => isBranchDone(nodes, branch.nodes, active))
}

/** 进入一个状态：激活自身，若为复合状态则递归激活每条支路的初始子状态 */
export function enterState(nodeId: string, nodes: StateNode[], active: Set<string>): void {
  active.add(nodeId)
  const node = nodes.find((item) => item.id === nodeId)
  if (node?.data.kind !== 'compound') return
  getBranches(nodes, nodeId).forEach((branch) => {
    const initial = branch.nodes.find((item) => item.data.initial) ?? branch.nodes[0]
    if (initial) enterState(initial.id, nodes, active)
  })
}

/** 退出一个状态及其所有后代 */
export function exitState(nodeId: string, nodes: StateNode[], active: Set<string>): void {
  active.delete(nodeId)
  nodes.filter((node) => node.parentId === nodeId).forEach((child) => exitState(child.id, nodes, active))
}

/** 计算初始激活配置：从根初始状态起步，递归进入复合状态 */
export function initialActiveStates(nodes: StateNode[]): string[] {
  const rootInitial = nodes.find((node) => !node.parentId && node.data.initial)
    ?? nodes.find((node) => !node.parentId && node.data.kind !== 'compound')
  if (!rootInitial) return []
  const active = new Set<string>()
  enterState(rootInitial.id, nodes, active)
  return Array.from(active)
}

/** 判断两个节点是否属于同一条支路（同一复合状态下的同一 branchId） */
export function sameBranch(a: StateNode, b: StateNode): boolean {
  if (!a.parentId || !b.parentId) return a.parentId === b.parentId
  return a.parentId === b.parentId && branchIdOf(a) === branchIdOf(b)
}

/** 守卫优先级选择：有守卫优先于无守卫；同优先级命中多条且排不出先后时标记冲突 */
export function selectByGuardPriority(
  edges: TransitionEdge[],
  context: Record<string, ContextValue>,
): { selected: TransitionEdge | null; conflict: boolean; conflictEdges: string[] } {
  const guarded = edges.filter((edge) => String(edge.data?.condition ?? '').trim() !== '')
  const unguarded = edges.filter((edge) => String(edge.data?.condition ?? '').trim() === '')
  const guardedTrue = guarded.filter((edge) => evaluateCondition(String(edge.data?.condition ?? ''), context))
  const unguardedTrue = unguarded.filter(() => true)

  if (guardedTrue.length === 1) return { selected: guardedTrue[0], conflict: false, conflictEdges: [] }
  if (guardedTrue.length > 1) {
    return { selected: guardedTrue[0], conflict: true, conflictEdges: guardedTrue.map((edge) => edge.id) }
  }
  if (unguardedTrue.length === 1) return { selected: unguardedTrue[0], conflict: false, conflictEdges: [] }
  if (unguardedTrue.length > 1) {
    return { selected: unguardedTrue[0], conflict: true, conflictEdges: unguardedTrue.map((edge) => edge.id) }
  }
  return { selected: null, conflict: false, conflictEdges: [] }
}

export interface SimResult {
  activeIds: string[]
  entries: TraceEntry[]
}

/**
 * 并行模拟：事件广播给所有激活支路。
 * - 每条支路独立按守卫优先级选一条转移；
 * - 某条支路先到结束不拖住其余支路；
 * - 所有支路都结束后，复合状态可被外部转移退出。
 */
export function simulateEvent(
  nodes: StateNode[],
  edges: TransitionEdge[],
  context: Record<string, ContextValue>,
  activeIds: string[],
  event: string,
  makeId: () => string,
): SimResult {
  const active = new Set(activeIds)
  const entries: TraceEntry[] = []
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  const pushEntry = (partial: Partial<TraceEntry> & { from: string; to: string; accepted: boolean }) => {
    entries.push({
      id: makeId(),
      event,
      condition: '',
      action: '',
      contextAfter: JSON.parse(JSON.stringify(context)) as Record<string, ContextValue>,
      timestamp,
      ...partial,
    })
  }

  // 1. 收集各激活叶子节点的候选转移，按支路分组
  const scopes = new Map<string, { leaf: StateNode; edges: TransitionEdge[] }>()
  active.forEach((id) => {
    const node = nodes.find((item) => item.id === id)
    if (!node || node.data.kind === 'compound') return
    const candidates = edges.filter((edge) => edge.source === id && String(edge.data?.event ?? '') === event)
    if (!candidates.length) return
    const compoundId = compoundParentId(node, nodes)
    const scopeKey = compoundId ? `${compoundId}::${branchIdOf(node)}` : `root::${node.id}`
    if (!scopes.has(scopeKey)) scopes.set(scopeKey, { leaf: node, edges: [] })
    scopes.get(scopeKey)!.edges.push(...candidates)
  })

  const handledCompounds = new Set<string>()

  // 2. 每条支路按守卫优先级选一条转移并应用
  scopes.forEach(({ leaf, edges: candidates }, scopeKey) => {
    const { selected, conflict, conflictEdges } = selectByGuardPriority(candidates, context)
    const compoundId = compoundParentId(leaf, nodes)
    if (compoundId) handledCompounds.add(compoundId)

    if (!selected) {
      const reason = candidates.length ? '守卫条件均未满足' : '当前状态没有订阅该事件'
      pushEntry({ from: leaf.id, to: leaf.id, accepted: false, reason, branchId: compoundId ? branchIdOf(leaf) : undefined })
      return
    }

    // 应用赋值
    const nextContext = { ...context }
    ;(selected.data?.assignments ?? []).forEach((assignment) => {
      if (assignment.variable) nextContext[assignment.variable] = resolveValue(assignment.expression, nextContext)
    })
    Object.assign(context, nextContext)

    const target = nodes.find((item) => item.id === selected.target)
    const targetCompound = target ? compoundParentId(target, nodes) : null
    const leavingCompound = compoundId && (!targetCompound || targetCompound !== compoundId || !sameBranch(leaf, target!))

    if (leavingCompound) {
      // 退出整个复合状态（所有支路一起退出）
      exitState(compoundId!, nodes, active)
      if (target) enterState(target.id, nodes, active)
    } else {
      // 支路内转移：退出当前叶子，进入目标（若目标为复合状态则递归激活）
      active.delete(leaf.id)
      nodes.filter((node) => node.parentId === leaf.id).forEach((child) => exitState(child.id, nodes, active))
      if (target) enterState(target.id, nodes, active)
    }

    pushEntry({
      from: leaf.id,
      to: selected.target,
      accepted: true,
      condition: String(selected.data?.condition ?? ''),
      action: String(selected.data?.action ?? ''),
      conflict,
      conflictEdges: conflict ? conflictEdges : undefined,
      branchId: compoundId ? branchIdOf(leaf) : undefined,
      reason: conflict ? '多条转移守卫排不出先后，已取第一条' : undefined,
    })
  })

  // 3. 复合状态退出转移：仅当没有任何支路处理该事件时触发
  active.forEach((id) => {
    const node = nodes.find((item) => item.id === id)
    if (node?.data.kind !== 'compound') return
    if (handledCompounds.has(id)) return
    const exitCandidates = edges.filter((edge) => edge.source === id && String(edge.data?.event ?? '') === event)
    if (!exitCandidates.length) return
    const { selected, conflict, conflictEdges } = selectByGuardPriority(exitCandidates, context)
    if (!selected) return

    const nextContext = { ...context }
    ;(selected.data?.assignments ?? []).forEach((assignment) => {
      if (assignment.variable) nextContext[assignment.variable] = resolveValue(assignment.expression, nextContext)
    })
    Object.assign(context, nextContext)

    const target = nodes.find((item) => item.id === selected.target)
    exitState(id, nodes, active)
    if (target) enterState(target.id, nodes, active)

    pushEntry({
      from: id,
      to: selected.target,
      accepted: true,
      condition: String(selected.data?.condition ?? ''),
      action: String(selected.data?.action ?? ''),
      conflict,
      conflictEdges: conflict ? conflictEdges : undefined,
      reason: conflict ? '多条退出转移守卫排不出先后，已取第一条' : undefined,
    })
  })

  // 4. 没有任何状态处理该事件
  if (!entries.length) {
    pushEntry({ from: activeIds[0] ?? '', to: activeIds[0] ?? '', accepted: false, reason: '当前激活状态均未订阅该事件' })
  }

  return { activeIds: Array.from(active), entries }
}

/** 将旧版单支路文档升级为并行结构：复合状态下的子状态补 branchId */
export function migrateDocument(document: MachineDocument): MachineDocument {
  if (document.version >= 2) return document
  const nodes = document.nodes.map((node) => {
    if (!node.parentId) return node
    // 旧版复合状态只有一条支路，统一归入 default 支路
    return { ...node, data: { ...node.data, branchId: node.data.branchId ?? 'default' } }
  })
  return { ...document, version: 2, nodes }
}


export function validateMachine(nodes: StateNode[], edges: TransitionEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const rootNodes = nodes.filter((node) => !node.parentId && node.data.kind !== 'compound')
  const initialState = nodes.find((node) => !node.parentId && node.data.initial) ?? rootNodes.find((node) => node.data.kind !== 'final')
  if (!initialState) {
    issues.push({ id: 'missing-initial', severity: 'error', title: '缺少初始状态', detail: '状态机至少需要一个根级初始状态。' })
  } else {
    const reachable = new Set<string>([initialState.id])
    const queue = [initialState.id]
    while (queue.length) {
      const id = queue.shift()!
      edges.filter((edge) => edge.source === id).forEach((edge) => {
        if (!reachable.has(edge.target)) {
          reachable.add(edge.target)
          queue.push(edge.target)
        }
      })
    }
    nodes.filter((node) => !node.parentId && node.data.kind !== 'compound' && !reachable.has(node.id)).forEach((node) => {
      issues.push({ id: `unreachable-${node.id}`, severity: 'error', title: '不可达状态', detail: `“${node.data.label}”无法从初始状态到达。`, nodeId: node.id })
    })
  }

  nodes.filter((node) => node.data.kind !== 'compound').forEach((node) => {
    const outgoing = edges.filter((edge) => edge.source === node.id)
    if (!outgoing.length && node.data.kind !== 'final') {
      issues.push({ id: `missing-${node.id}`, severity: 'warning', title: '缺少转移', detail: `“${node.data.label}”没有任何出站转移。`, nodeId: node.id })
    }
  })

  nodes.filter((node) => node.data.kind === 'compound').forEach((node) => {
    const branches = getBranches(nodes, node.id)
    if (!branches.length) {
      issues.push({ id: `empty-${node.id}`, severity: 'warning', title: '复合状态为空', detail: `“${node.data.label}”尚未配置子状态。`, nodeId: node.id })
      return
    }
    branches.forEach((branch) => {
      if (!branch.nodes.some((child) => child.data.initial)) {
        issues.push({
          id: `branch-initial-${node.id}-${branch.branchId}`,
          severity: 'warning',
          title: '支路缺少初始项',
          detail: `“${node.data.label}”的支路需要标记一个初始子状态。`,
          nodeId: node.id,
        })
      }
    })
  })

  // 同一状态下同事件同条件的重复转移（按支路作用域）
  const groups = new Map<string, TransitionEdge[]>()
  edges.forEach((edge) => {
    const source = nodes.find((node) => node.id === edge.source)
    const scope = source?.parentId ? `${source.parentId}::${branchIdOf(source)}` : 'root'
    const key = `${scope}::${edge.source}::${String(edge.data?.event ?? '')}::${String(edge.data?.condition ?? '')}`
    groups.set(key, [...(groups.get(key) ?? []), edge])
  })
  groups.forEach((sameEdges) => {
    if (sameEdges.length > 1) {
      const first = sameEdges[0]
      issues.push({
        id: `duplicate-${first.id}`,
        severity: 'error',
        title: '重复事件',
        detail: `同一状态下的 “${String(first.data?.event)} / ${String(first.data?.condition || '无条件')}” 出现了 ${sameEdges.length} 次。`,
        edgeId: first.id,
      })
    }
  })
  return issues
}

interface ExportStateConfig {
  initial?: string
  type?: 'parallel' | 'final'
  states: Record<string, ExportStateConfig>
  on?: Record<string, { target: string } | Array<{ target: string }>>
}

export function xstateConfig(nodes: StateNode[], edges: TransitionEdge[], variables: MachineDocument['variables']) {
  const rootInitial = nodes.find((node) => !node.parentId && node.data.initial)?.id
    ?? nodes.find((node) => !node.parentId && node.data.kind !== 'compound')?.id

  const buildTransitions = (sourceId: string) => {
    const transitions: Record<string, Array<{ target: string }>> = {}
    edges.filter((edge) => edge.source === sourceId).forEach((edge) => {
      const event = String(edge.data?.event ?? 'EVENT')
      transitions[event] = [...(transitions[event] ?? []), { target: edge.target }]
    })
    return transitions
  }

  const buildState = (node: StateNode): ExportStateConfig => {
    const children = nodes.filter((child) => child.parentId === node.id)
    if (node.data.kind === 'compound' && children.length) {
      const branches = getBranches(nodes, node.id)
      const regionStates: Record<string, ExportStateConfig> = {}
      branches.forEach((branch) => {
        const regionName = `region_${branch.branchId.replace(/[^A-Za-z0-9_]/g, '_')}`
        const regionChildStates: Record<string, ExportStateConfig> = {}
        branch.nodes.forEach((child) => {
          regionChildStates[child.id] = buildState(child)
        })
        regionStates[regionName] = {
          initial: branch.nodes.find((child) => child.data.initial)?.id,
          states: regionChildStates,
        }
      })
      return {
        type: 'parallel',
        states: regionStates,
        on: buildTransitions(node.id),
      }
    }
    if (node.data.kind === 'final') {
      return { type: 'final', states: {}, on: buildTransitions(node.id) }
    }
    return { states: {}, on: buildTransitions(node.id) }
  }

  const states: Record<string, ExportStateConfig> = {}
  nodes.filter((node) => !node.parentId).forEach((node) => {
    states[node.id] = buildState(node)
  })

  const context = Object.fromEntries(variables.map((variable) => [variable.name, variable.initial]))
  const config: Record<string, unknown> = {
    id: 'StateBoardMachine',
    initial: rootInitial,
    context,
    states,
  }
  return config
}

export function compileMachine(nodes: StateNode[], edges: TransitionEdge[], variables: MachineDocument['variables']) {
  return createMachine(xstateConfig(nodes, edges, variables))
}

export function mermaidDiagram(nodes: StateNode[], edges: TransitionEdge[]) {
  const safeId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_')
  const lines = ['stateDiagram-v2']
  const initial = nodes.find((node) => !node.parentId && node.data.initial)
  if (initial) lines.push(`  [*] --> ${safeId(initial.id)}`)
  nodes.forEach((node) => {
    if (node.data.kind === 'final') lines.push(`  state "${node.data.label}" as ${safeId(node.id)}`)
  })
  edges.forEach((edge) => {
    const label = [edge.data?.event, edge.data?.condition ? `[${edge.data.condition}]` : '', edge.data?.action].filter(Boolean).join(' / ')
    lines.push(`  ${safeId(edge.source)} --> ${safeId(edge.target)}: ${label || 'event'}`)
  })
  nodes.filter((node) => node.data.kind === 'final').forEach((node) => lines.push(`  ${safeId(node.id)} --> [*]`))
  return lines.join('\n')
}
