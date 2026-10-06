import { createMachine } from 'xstate'
import type {
  ContextValue,
  MachineDocument,
  MachineDocumentLike,
  ParallelBranch,
  StateNode,
  TransitionEdge,
  ValidationIssue,
} from '../types/machine'

export const DONE_EVENT = 'DONE'
export const DEFAULT_BRANCH_ID = 'main'

export function sendEventId() {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function stateId(prefix = 'state') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function branchId() {
  return `branch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createDefaultBranch(label = '主支路'): ParallelBranch {
  return { id: DEFAULT_BRANCH_ID, label }
}

export function createState(label: string, position: { x: number; y: number }, kind: StateNode['data']['kind'] = 'simple', parentId?: string, branch?: string): StateNode {
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
    if (branch) node.data.branchId = branch
  }
  if (kind === 'compound') {
    node.data.branches = [createDefaultBranch()]
    node.data.parallel = false
    node.style = { width: 460, height: 310 }
    node.zIndex = 0
  }
  return node
}

/** 复合状态的支路定义，缺省时视为一条主支路 */
export function branchesOf(node: StateNode | undefined): ParallelBranch[] {
  if (!node || node.data.kind !== 'compound') return []
  if (node.data.branches && node.data.branches.length) return node.data.branches
  return [createDefaultBranch()]
}

/** 子状态所属支路；未标注时归到复合状态的第一条支路 */
export function branchOf(child: StateNode, parent?: StateNode): ParallelBranch {
  const branches = branchesOf(parent)
  return branches.find((branch) => branch.id === child.data.branchId) ?? branches[0] ?? createDefaultBranch()
}

export function branchLabelOf(child: StateNode, nodes: StateNode[]): string | undefined {
  if (!child.parentId) return undefined
  const parent = nodes.find((node) => node.id === child.parentId)
  if (!parent || parent.data.kind !== 'compound') return undefined
  return branchOf(child, parent).label
}

function childrenOf(nodes: StateNode[], parentId: string) {
  return nodes.filter((node) => node.parentId === parentId)
}

/** 某条支路的初始子状态：优先支路内标了 initial 的，否则取支路内第一个子状态 */
export function branchInitialChild(nodes: StateNode[], compound: StateNode, branchIdValue: string): StateNode | undefined {
  const children = childrenOf(nodes, compound.id)
  const inBranch = children.filter((child) => branchOf(child, compound).id === branchIdValue)
  return inBranch.find((child) => child.data.initial) ?? inBranch[0]
}

export function sampleMachine(): { nodes: StateNode[]; edges: TransitionEdge[]; variables: MachineDocument['variables'] } {
  const idle = createState('待提交', { x: 60, y: 150 })
  idle.id = 'idle'
  idle.data.initial = true
  idle.data.description = '等待用户提交业务申请'

  const review = createState('申请联合审核', { x: 330, y: 60 }, 'compound')
  review.id = 'review'
  review.data.description = '风控与额度两条支路并行审核，全部完成后才放行'
  review.data.parallel = true
  review.data.branches = [
    { id: 'risk', label: '风控支路' },
    { id: 'quota', label: '额度支路' },
  ]
  review.style = { width: 470, height: 320 }

  const riskChecking = createState('风控审核中', { x: 28, y: 72 }, 'simple', 'review', 'risk')
  riskChecking.id = 'risk_checking'
  riskChecking.data.initial = true
  riskChecking.data.description = '核查申请人风险等级'

  const riskFlagged = createState('风控完成', { x: 28, y: 190 }, 'final', 'review', 'risk')
  riskFlagged.id = 'risk_flagged'
  riskFlagged.data.description = '风控支路结束，不影响额度支路继续执行'

  const quotaChecking = createState('额度审核中', { x: 240, y: 72 }, 'simple', 'review', 'quota')
  quotaChecking.id = 'quota_checking'
  quotaChecking.data.initial = true
  quotaChecking.data.description = '核查可用额度是否充足'

  const quotaHold = createState('额度完成', { x: 240, y: 190 }, 'final', 'review', 'quota')
  quotaHold.id = 'quota_done'
  quotaHold.data.description = '额度支路结束，等待风控支路收尾'

  const approved = createState('已通过', { x: 880, y: 80 }, 'final')
  approved.id = 'approved'

  const rejected = createState('已驳回', { x: 880, y: 270 }, 'final')
  rejected.id = 'rejected'

  const draft = createState('草稿补充', { x: 60, y: 330 })
  draft.id = 'draft'

  const edges: TransitionEdge[] = [
    { id: 't1', source: 'idle', target: 'review', type: 'transition', data: { event: 'SUBMIT', condition: '', action: '记录提交时间', assignments: [] } },
    { id: 't2', source: 'risk_checking', target: 'risk_flagged', type: 'transition', data: { event: 'RISK_DONE', condition: '', action: '记录风控结论', assignments: [] } },
    { id: 't3', source: 'quota_checking', target: 'quota_done', type: 'transition', data: { event: 'QUOTA_DONE', condition: '', action: '锁定额度', assignments: [] } },
    {
      id: 't4',
      source: 'review',
      target: 'approved',
      type: 'transition',
      data: {
        event: DONE_EVENT,
        condition: 'riskLevel == "low" && quotaSufficient == true',
        priority: 2,
        action: '两条支路均完成，自动审批通过',
        assignments: [],
      },
    },
    {
      id: 't5',
      source: 'review',
      target: 'rejected',
      type: 'transition',
      data: { event: DONE_EVENT, condition: '', priority: 0, action: '存在支路未通过，驳回申请', assignments: [] },
    },
    { id: 't6', source: 'rejected', target: 'draft', type: 'transition', data: { event: 'REVISE', condition: '', action: '进入补充资料', assignments: [] } },
    { id: 't7', source: 'draft', target: 'idle', type: 'transition', data: { event: 'RESUBMIT', condition: '', action: '重新提交申请', assignments: [] } },
  ]
  return {
    nodes: [idle, review, riskChecking, riskFlagged, quotaChecking, quotaHold, approved, rejected, draft],
    edges,
    variables: [
      { name: 'amount', type: 'number', initial: 8000 },
      { name: 'riskLevel', type: 'string', initial: 'high' },
      { name: 'quotaSufficient', type: 'boolean', initial: false },
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

/**
 * 守卫优先级：显式配置的 priority 优先；默认“带守卫 1、空守卫 0”。
 * 数值越大越优先。
 */
export function guardPriority(edge: TransitionEdge): number {
  const explicit = edge.data?.priority
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  return String(edge.data?.condition ?? '').trim() ? 1 : 0
}

type Selection =
  | { kind: 'none' }
  | { kind: 'blocked'; candidates: TransitionEdge[] }
  | { kind: 'edge'; edge: TransitionEdge }
  | { kind: 'conflict'; edges: TransitionEdge[]; priority: number }

/** 同一来源、同一事件的多条转移按守卫优先级取一条；并列最高则报冲突 */
function selectTransition(edges: TransitionEdge[], sourceId: string, event: string, context: Record<string, ContextValue>): Selection {
  const candidates = edges.filter((edge) => edge.source === sourceId && String(edge.data?.event ?? '') === event)
  if (!candidates.length) return { kind: 'none' }
  const eligible = candidates.filter((candidate) => evaluateCondition(String(candidate.data?.condition ?? ''), context))
  if (!eligible.length) return { kind: 'blocked', candidates }
  let best = eligible[0].data?.priority
  let bestPriority = guardPriority(eligible[0])
  for (const candidate of eligible.slice(1)) {
    const priority = guardPriority(candidate)
    if (priority > bestPriority) {
      bestPriority = priority
      best = candidate.data?.priority
    }
  }
  const winners = eligible.filter((candidate) => guardPriority(candidate) === bestPriority)
  if (winners.length > 1) return { kind: 'conflict', edges: winners, priority: bestPriority }
  return { kind: 'edge', edge: winners[0] }
}

/** 旧版本文档迁移：复合状态补齐支路定义，并把原单支路标记为一条并行支路 */
export function migrateDocument(document: MachineDocumentLike): MachineDocument {
  const nodes: StateNode[] = JSON.parse(JSON.stringify(document.nodes ?? [])) as StateNode[]
  const version = document.version ?? 1
  nodes.forEach((node) => {
    if (node.data.kind !== 'compound') return
    if (!node.data.branches || !node.data.branches.length) {
      node.data.branches = [createDefaultBranch()]
    }
    // 旧数据原本只有一条串行支路，升级后补成“一条并行支路”
    if (version < 2) node.data.parallel = true
    if (node.data.parallel === undefined) node.data.parallel = false
    const branches = branchesOf(node)
    childrenOf(nodes, node.id).forEach((child) => {
      if (!child.data.branchId || !branches.some((branch) => branch.id === child.data.branchId)) {
        child.data.branchId = branches[0].id
      }
    })
  })
  return {
    version: 2,
    name: document.name ?? '未命名状态机',
    nodes,
    edges: (JSON.parse(JSON.stringify(document.edges ?? [])) as TransitionEdge[]),
    variables: (document.variables ?? []) as MachineDocument['variables'],
    savedAt: document.savedAt ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 并行模拟引擎
// ---------------------------------------------------------------------------

export interface TraceDraft {
  event: string
  from: string
  to: string
  branchId?: string
  branchLabel?: string
  condition: string
  action: string
  accepted: boolean
  conflict?: boolean
  reason?: string
  contextAfter: Record<string, ContextValue>
}

interface ActiveLeaf {
  nodeId: string
  compoundId?: string
  branchId?: string
}

export interface StepResult {
  activeIds: string[]
  context: Record<string, ContextValue>
  drafts: TraceDraft[]
}

function leafOf(nodeId: string, nodes: StateNode[]): ActiveLeaf {
  const node = nodes.find((item) => item.id === nodeId)
  if (node?.parentId) return { nodeId, compoundId: node.parentId, branchId: branchOf(node, nodes.find((parent) => parent.id === node.parentId)).id }
  return { nodeId }
}

/** 进入一个目标状态：复合状态让每条支路从各自初始子状态起步；目标是内部子状态时，目标支路直接定位到它 */
function enterTarget(targetId: string, nodes: StateNode[]): ActiveLeaf[] {
  const target = nodes.find((node) => node.id === targetId)
  if (!target) return [{ nodeId: targetId }]
  if (target.data.kind !== 'compound' && !target.parentId) return [{ nodeId: targetId }]
  if (target.data.kind === 'compound') {
    return branchesOf(target)
      .map((branch) => branchInitialChild(nodes, target, branch.id))
      .filter((child): child is StateNode => Boolean(child))
      .map((child) => ({ nodeId: child.id, compoundId: target.id, branchId: branchOf(child, target).id }))
  }
  // 目标是复合状态内部子状态：它所在支路定位到目标，其余支路从初始子状态起步
  const compound = nodes.find((node) => node.id === target.parentId)
  if (!compound) return [{ nodeId: targetId }]
  return branchesOf(compound).map((branch): ActiveLeaf | null => {
    if (branch.id === branchOf(target, compound).id) {
      return { nodeId: target.id, compoundId: compound.id, branchId: branch.id }
    }
    const initial = branchInitialChild(nodes, compound, branch.id)
    return initial ? { nodeId: initial.id, compoundId: compound.id, branchId: branch.id } : null
  }).filter((leaf): leaf is ActiveLeaf => Boolean(leaf))
}

function rootInitial(nodes: StateNode[]): StateNode | undefined {
  const roots = nodes.filter((node) => !node.parentId)
  return roots.find((node) => node.data.initial)
    ?? roots.find((node) => node.data.kind !== 'final' && node.data.kind !== 'compound')
    ?? roots.find((node) => node.data.kind === 'compound')
}

/** 模拟启动：从根初始状态进入（若它是并行复合状态，所有支路同时起步） */
export function startEntries(nodes: StateNode[]): string[] {
  const initial = rootInitial(nodes)
  return initial ? enterTarget(initial.id, nodes).map((leaf) => leaf.nodeId) : []
}

interface Decision {
  leaf: ActiveLeaf
  selection: Selection
}

function snapshot(context: Record<string, ContextValue>) {
  return JSON.parse(JSON.stringify(context)) as Record<string, ContextValue>
}

function applyAssignments(edge: TransitionEdge, context: Record<string, ContextValue>) {
  ;(edge.data?.assignments ?? []).forEach((assignment) => {
    if (assignment.variable) context[assignment.variable] = resolveValue(assignment.expression, context)
  })
}

/**
 * 向当前所有激活支路广播一个事件。
 * 各支路独立选路；某条支路先到结束不会拖住其他支路；
 * 复合状态下每条支路都到结束，才触发整体完成转移。
 */
export function stepEvent(
  event: string,
  activeIds: string[],
  nodes: StateNode[],
  edges: TransitionEdge[],
  initialContext: Record<string, ContextValue>,
): StepResult {
  const context = snapshot(initialContext)
  const drafts: TraceDraft[] = []
  let leaves = activeIds.map((id) => leafOf(id, nodes))

  const decisions: Decision[] = leaves.map((leaf) => ({ leaf, selection: selectTransition(edges, leaf.nodeId, event, context) }))
  const accepted = decisions.filter((decision) => decision.selection.kind === 'edge' || decision.selection.kind === 'conflict')

  if (!accepted.length) {
    // 没有任何支路移动：广播未命中，记录一条忽略轨迹
    const first = leaves[0]
    if (first) {
      const blocked = decisions.find((decision) => decision.selection.kind === 'blocked')
      drafts.push({
        event,
        from: first.nodeId,
        to: first.nodeId,
        branchId: first.branchId,
        branchLabel: first.compoundId ? branchLabelOf(nodes.find((node) => node.id === first.nodeId)!, nodes) : undefined,
        condition: '',
        action: '忽略事件',
        accepted: false,
        reason: blocked ? '条件均未满足' : '当前激活支路均未订阅该事件',
        contextAfter: snapshot(context),
      })
    }
    return { activeIds, context, drafts }
  }

  const draftFor = (decision: Decision, overrides: Partial<TraceDraft>): TraceDraft => {
    const leaf = decision.leaf
    const child = nodes.find((node) => node.id === leaf.nodeId)
    const selection = decision.selection
    const edge = selection.kind === 'edge' ? selection.edge : undefined
    return {
      event,
      from: leaf.nodeId,
      to: edge?.target ?? leaf.nodeId,
      branchId: leaf.branchId,
      branchLabel: leaf.compoundId && child ? branchLabelOf(child, nodes) : undefined,
      condition: String(edge?.data?.condition ?? ''),
      action: String(edge?.data?.action ?? ''),
      accepted: selection.kind === 'edge',
      conflict: selection.kind === 'conflict',
      reason: selection.kind === 'conflict'
        ? `守卫优先级相同（${selection.priority}），${selection.edges.length} 条转移无法排出先后，已忽略`
        : undefined,
      contextAfter: snapshot(context),
      ...overrides,
    }
  }

  // 冲突支路直接记轨迹，不移动
  decisions.filter((decision) => decision.selection.kind === 'conflict').forEach((decision) => drafts.push(draftFor(decision, { contextAfter: snapshot(context) })))

  const moving = decisions.filter((decision) => decision.selection.kind === 'edge') as Array<Decision & { selection: Extract<Selection, { kind: 'edge' }> }>

  // 局部移动：复合状态支路内转移，只影响该支路
  const localMoves = moving.filter(({ leaf, selection }) => {
    if (!leaf.compoundId) return false
    const target = nodes.find((node) => node.id === selection.edge.target)
    return target?.parentId === leaf.compoundId && target.id !== leaf.compoundId
  })
  localMoves.forEach((decision) => {
    const edge = decision.selection.edge
    applyAssignments(edge, context)
    const target = nodes.find((node) => node.id === edge.target)!
    leaves = leaves.map((leaf) => leaf.nodeId === decision.leaf.nodeId
      ? { nodeId: edge.target, compoundId: leaf.compoundId, branchId: branchOf(target, nodes.find((parent) => parent.id === leaf.compoundId)).id }
      : leaf)
    drafts.push(draftFor(decision, { contextAfter: snapshot(context) }))
  })

  // 越界移动：支路转出复合状态 / 根状态转移，整个当前作用域被替换
  const switches = moving.filter((decision) => !localMoves.includes(decision))
  if (switches.length) {
    const targets = [...new Set(switches.map((decision) => decision.selection.edge.target))]
    if (targets.length > 1) {
      // 多条支路要转出到不同目标，同样视为无法排出先后的冲突
      switches.forEach((decision) => drafts.push(draftFor(
        { leaf: decision.leaf, selection: { kind: 'conflict', edges: switches.map((item) => item.selection.edge), priority: -1 } },
        { reason: `多条激活支路同时要求转出到不同目标（${targets.map((target) => nodes.find((node) => node.id === target)?.data.label ?? target).join('、')}），已忽略`, contextAfter: snapshot(context) },
      )))
    } else {
      const target = targets[0]
      switches.forEach((decision) => {
        applyAssignments(decision.selection.edge, context)
        drafts.push(draftFor(decision, { to: target, contextAfter: snapshot(context) }))
      })
      leaves = enterTarget(target, nodes)
    }
  }

  // 全部支路到达结束 → 复合状态整体完成，触发 DONE 转移（可链式进入下一个复合状态）
  const handledCompounds = new Set<string>()
  for (;;) {
    const completed = findCompletedCompounds(leaves, nodes).filter((compound) => !handledCompounds.has(compound.id))
    if (!completed.length) break
    for (const compound of completed) {
      handledCompounds.add(compound.id)
      const selection = selectDoneTransition(edges, compound.id, context)
      if (selection.kind === 'none') continue
      if (selection.kind === 'blocked') {
        drafts.push({
          event: DONE_EVENT,
          from: compound.id,
          to: compound.id,
          condition: '',
          action: '等待完成转移',
          accepted: false,
          reason: '全部支路已结束，但完成转移条件均未满足',
          contextAfter: snapshot(context),
        })
        continue
      }
      if (selection.kind === 'conflict') {
        drafts.push({
          event: DONE_EVENT,
          from: compound.id,
          to: compound.id,
          condition: '',
          action: '忽略完成事件',
          accepted: false,
          conflict: true,
          reason: `完成转移守卫优先级相同（${selection.priority}），${selection.edges.length} 条转移冲突，已忽略`,
          contextAfter: snapshot(context),
        })
        continue
      }
      const edge = selection.edge
      applyAssignments(edge, context)
      leaves = leaves.filter((leaf) => leaf.compoundId !== compound.id)
      leaves = [...leaves, ...enterTarget(edge.target, nodes)]
      drafts.push({
        event: DONE_EVENT,
        from: compound.id,
        to: edge.target,
        condition: String(edge.data?.condition ?? ''),
        action: String(edge.data?.action ?? '全部支路完成'),
        accepted: true,
        contextAfter: snapshot(context),
      })
    }
  }

  return { activeIds: leaves.map((leaf) => leaf.nodeId), context, drafts }
}

/** 每条支路当前都停在结束子状态上，才算复合状态整体完成 */
function findCompletedCompounds(leaves: ActiveLeaf[], nodes: StateNode[]): StateNode[] {
  const compoundIds = [...new Set(leaves.map((leaf) => leaf.compoundId).filter((id): id is string => Boolean(id)))]
  return compoundIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((compound): compound is StateNode => Boolean(compound && compound.data.kind === 'compound'))
    .filter((compound) => branchesOf(compound).every((branch) => {
      const leaf = leaves.find((item) => item.compoundId === compound.id && item.branchId === branch.id)
      const node = leaf && nodes.find((item) => item.id === leaf.nodeId)
      return Boolean(node && node.data.kind === 'final')
    }))
}

/** 复合状态的完成转移：事件 DONE（或历史遗留的空事件），同样按守卫优先级取一条 */
function selectDoneTransition(edges: TransitionEdge[], compoundId: string, context: Record<string, ContextValue>): Selection {
  const candidates = edges.filter((edge) => edge.source === compoundId && [DONE_EVENT, ''].includes(String(edge.data?.event ?? '')))
  if (!candidates.length) return { kind: 'none' }
  const eligible = candidates.filter((candidate) => evaluateCondition(String(candidate.data?.condition ?? ''), context))
  if (!eligible.length) return { kind: 'blocked', candidates }
  const bestPriority = Math.max(...eligible.map(guardPriority))
  const winners = eligible.filter((candidate) => guardPriority(candidate) === bestPriority)
  if (winners.length > 1) return { kind: 'conflict', edges: winners, priority: bestPriority }
  return { kind: 'edge', edge: winners[0] }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export function validateMachine(nodes: StateNode[], edges: TransitionEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const initialState = rootInitial(nodes)
  if (!initialState) {
    issues.push({ id: 'missing-initial', severity: 'error', title: '缺少初始状态', detail: '状态机至少需要一个根级初始状态。' })
  } else {
    // 可达性：进入复合状态时，每条并行支路的初始子状态同时被激活
    const reachable = new Set<string>([initialState.id])
    const queue = [initialState.id]
    const enqueue = (id: string) => {
      if (reachable.has(id)) return
      reachable.add(id)
      queue.push(id)
      const node = nodes.find((item) => item.id === id)
      if (node?.data.kind === 'compound') {
        branchesOf(node).forEach((branch) => {
          const child = branchInitialChild(nodes, node, branch.id)
          if (child) enqueue(child.id)
        })
      }
    }
    while (queue.length) {
      const id = queue.shift()!
      edges.filter((edge) => edge.source === id).forEach((edge) => enqueue(edge.target))
    }
    nodes.filter((node) => node.data.kind !== 'compound' && !reachable.has(node.id)).forEach((node) => {
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
    const branches = branchesOf(node)
    const children = childrenOf(nodes, node.id)
    if (!children.length) {
      issues.push({ id: `empty-${node.id}`, severity: 'warning', title: '复合状态为空', detail: `“${node.data.label}”尚未配置子状态。`, nodeId: node.id })
    }
    branches.forEach((branch) => {
      const inBranch = children.filter((child) => branchOf(child, node).id === branch.id)
      if (!inBranch.length) {
        issues.push({ id: `empty-branch-${node.id}-${branch.id}`, severity: 'warning', title: '支路为空', detail: `“${node.data.label}”的“${branch.label}”还没有子状态。`, nodeId: node.id })
      } else if (!inBranch.some((child) => child.data.initial)) {
        issues.push({ id: `branch-initial-${node.id}-${branch.id}`, severity: 'warning', title: '支路缺少初始子状态', detail: `“${node.data.label}”的“${branch.label}”需要标记一个初始子状态。`, nodeId: node.id })
      }
    })
    if (node.data.parallel && branches.length < 2) {
      issues.push({ id: `single-branch-${node.id}`, severity: 'warning', title: '并行复合状态只有一条支路', detail: `“${node.data.label}”标记为并行，但只配置了一条支路；可继续添加支路或取消并行。`, nodeId: node.id })
    }
    const doneEdges = edges.filter((edge) => edge.source === node.id)
    if (children.length && !doneEdges.length) {
      issues.push({ id: `no-done-${node.id}`, severity: 'warning', title: '缺少完成转移', detail: `“${node.data.label}”所有支路结束后没有可触发的转移（可从复合状态边框连出 ${DONE_EVENT} 转移）。`, nodeId: node.id })
    }
  })

  const groups = new Map<string, TransitionEdge[]>()
  edges.forEach((edge) => {
    const key = `${edge.source}::${String(edge.data?.event ?? '')}::${String(edge.data?.condition ?? '')}`
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

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

interface ExportStateConfig {
  id?: string
  type?: 'parallel' | 'final'
  initial?: string
  states: Record<string, ExportStateConfig>
  on?: Record<string, unknown>
  onDone?: unknown
}

function targetRef(edge: TransitionEdge, sourceParent: string | undefined, nodes: StateNode[]): string {
  const target = nodes.find((node) => node.id === edge.target)
  // 同一作用域（都在根级，或都在同一条支路内）用相对目标；跨作用域用显式 id 引用
  const sameScope = (target?.parentId ?? undefined) === sourceParent
  return sameScope ? edge.target : `#${edge.target}`
}

function transitionConfig(edges: TransitionEdge[], sourceParent: string | undefined, nodes: StateNode[], done = false) {
  // 同一事件的多条守卫转移按优先级降序排列，XState 取第一个守卫满足者
  const order = (list: TransitionEdge[]) => [...list].sort((a, b) => guardPriority(b) - guardPriority(a))
  const grouped = new Map<string, TransitionEdge[]>()
  edges.forEach((edge) => {
    const event = String(edge.data?.event ?? 'EVENT')
    grouped.set(event, [...(grouped.get(event) ?? []), edge])
  })
  const result: Record<string, unknown> = {}
  const put = (key: string, list: TransitionEdge[]) => {
    const entries = order(list).map((edge): Record<string, unknown> => {
      const condition = String(edge.data?.condition ?? '').trim()
      const entry: Record<string, unknown> = { target: targetRef(edge, sourceParent, nodes) }
      if (condition) entry.guard = ({ context }: { context: Record<string, unknown> }) => evaluateCondition(condition, context as Record<string, ContextValue>)
      return entry
    })
    result[key] = entries.length > 1 ? entries : entries[0]
  }
  if (done) {
    put('onDone', edges)
    return result
  }
  grouped.forEach((list, event) => put(event, list))
  return { on: result }
}

export function xstateConfig(nodes: StateNode[], edges: TransitionEdge[], variables: MachineDocument['variables']) {
  const rootInitialState = rootInitial(nodes)
  const states: Record<string, ExportStateConfig> = {}

  nodes.filter((node) => !node.parentId).forEach((node) => {
    const config: ExportStateConfig = { id: node.id, states: {} }
    if (node.data.kind === 'final') config.type = 'final'
    const outgoing = edges.filter((edge) => edge.source === node.id)

    if (node.data.kind === 'compound') {
      const branches = branchesOf(node)
      const children = childrenOf(nodes, node.id)
      const buildChild = (child: StateNode): ExportStateConfig => {
        const childConfig: ExportStateConfig = {
          id: child.id,
          states: {},
          ...transitionConfig(edges.filter((edge) => edge.source === child.id), node.id, nodes),
        }
        if (child.data.kind === 'final') childConfig.type = 'final'
        return childConfig
      }
      if (node.data.parallel) {
        // 按并行结构导出：每条支路是一个 region
        config.type = 'parallel'
        branches.forEach((branch) => {
          const branchChildren = children.filter((child) => branchOf(child, node).id === branch.id)
          config.states[branch.id] = {
            id: `${node.id}.${branch.id}`,
            initial: branchInitialChild(nodes, node, branch.id)?.id,
            states: Object.fromEntries(branchChildren.map((child) => [child.id, buildChild(child)])),
          }
        })
      } else {
        config.initial = branchesOf(node)[0] ? branchInitialChild(nodes, node, branchesOf(node)[0].id)?.id : undefined
        children.forEach((child) => { config.states[child.id] = buildChild(child) })
      }
      const doneEdges = outgoing.filter((edge) => [DONE_EVENT, ''].includes(String(edge.data?.event ?? '')))
      const otherEdges = outgoing.filter((edge) => !doneEdges.includes(edge))
      if (otherEdges.length) Object.assign(config, transitionConfig(otherEdges, node.parentId, nodes))
      if (doneEdges.length) Object.assign(config, transitionConfig(doneEdges, node.parentId, nodes, true))
    } else {
      Object.assign(config, transitionConfig(outgoing, undefined, nodes))
    }
    states[node.id] = config
  })

  const context = Object.fromEntries(variables.map((variable) => [variable.name, variable.initial]))
  return {
    id: 'StateBoardMachine',
    initial: rootInitialState?.id,
    context,
    states,
  }
}

export function compileMachine(nodes: StateNode[], edges: TransitionEdge[], variables: MachineDocument['variables']) {
  return createMachine(xstateConfig(nodes, edges, variables) as never)
}

export function mermaidDiagram(nodes: StateNode[], edges: TransitionEdge[]) {
  const safeId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_')
  const lines = ['stateDiagram-v2']
  const initial = rootInitial(nodes)
  if (initial) lines.push(`  [*] --> ${safeId(initial.id)}`)
  const parallelCompounds = nodes.filter((node) => node.data.kind === 'compound' && node.data.parallel)
  const insideCompound = new Set<string>()
  parallelCompounds.forEach((compound) => childrenOf(nodes, compound.id).forEach((child) => insideCompound.add(child.id)))

  const renderEdge = (edge: TransitionEdge, indent: string) => {
    const label = [edge.data?.event, edge.data?.condition ? `[${edge.data.condition}]` : '', edge.data?.action].filter(Boolean).join(' / ')
    lines.push(`${indent}${safeId(edge.source)} --> ${safeId(edge.target)}: ${label || 'event'}`)
  }

  parallelCompounds.forEach((compound) => {
    const branches = branchesOf(compound)
    lines.push(`  state "${compound.data.label}" as ${safeId(compound.id)} {`)
    branches.forEach((branch) => {
      lines.push(`    state "${branch.label}" as ${safeId(`${compound.id}_${branch.id}`)} {`)
      const branchChildren = childrenOf(nodes, compound.id).filter((child) => branchOf(child, compound).id === branch.id)
      const branchChildIds = new Set(branchChildren.map((child) => child.id))
      branchChildren.forEach((child) => {
        if (child.data.kind === 'final') lines.push(`      state "${child.data.label}" as ${safeId(child.id)}`)
      })
      const initialChild = branchChildren.find((child) => child.data.initial)
      if (initialChild) lines.push(`      [*] --> ${safeId(initialChild.id)}`)
      edges.filter((edge) => branchChildIds.has(edge.source) && branchChildIds.has(edge.target)).forEach((edge) => renderEdge(edge, '      '))
      lines.push('    }')
    })
    lines.push('  }')
  })

  edges.forEach((edge) => {
    if (insideCompound.has(edge.source) && insideCompound.has(edge.target)) {
      const source = nodes.find((node) => node.id === edge.source)
      const target = nodes.find((node) => node.id === edge.target)
      if (source && target && source.parentId === target.parentId && parallelCompounds.some((compound) => compound.id === source.parentId)) return
    }
    renderEdge(edge, '  ')
  })
  nodes.filter((node) => node.data.kind === 'final' && !node.parentId).forEach((node) => lines.push(`  ${safeId(node.id)} --> [*]`))
  return lines.join('\n')
}
