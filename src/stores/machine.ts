import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  ContextValue,
  ContextVariable,
  MachineDocument,
  StateNode,
  TraceEntry,
  TransitionEdge,
  TransitionData,
  ValidationIssue,
} from '../types/machine'
import {
  DONE_EVENT,
  branchId as makeBranchId,
  branchOf,
  branchesOf,
  createState,
  migrateDocument,
  sampleMachine,
  sendEventId,
  startEntries,
  stepEvent,
  validateMachine,
} from '../utils/machine'

interface MachineState {
  name: string
  nodes: StateNode[]
  edges: TransitionEdge[]
  variables: ContextVariable[]
  context: Record<string, ContextValue>
  /** 所有当前激活的叶子状态：根状态或并行复合状态下各支路的当前子状态 */
  activeStateIds: string[]
  /** 模拟代次：结构、转移或上下文一有改动就自增，正在跑的并行模拟随即作废重算 */
  simulationSeq: number
  selectedNodeId: string | null
  selectedEdgeId: string | null
  trace: TraceEntry[]
  issues: ValidationIssue[]
  notice: string
  setName: (name: string) => void
  onNodesChange: (changes: NodeChange<StateNode>[]) => void
  onEdgesChange: (changes: EdgeChange<TransitionEdge>[]) => void
  connect: (connection: Connection) => void
  addState: (kind: StateNode['data']['kind'], parentId?: string | null) => void
  selectNode: (id: string | null) => void
  selectEdge: (id: string | null) => void
  updateNode: (id: string, patch: Partial<StateNode['data']>) => void
  updateEdge: (id: string, patch: Partial<TransitionData>) => void
  deleteSelection: () => void
  setInitial: (id: string) => void
  addBranch: (compoundId: string) => void
  removeBranch: (compoundId: string, branchId: string) => void
  updateBranch: (compoundId: string, branchId: string, patch: { label?: string }) => void
  setNodeBranch: (nodeId: string, branchId: string) => void
  addVariable: () => void
  updateVariable: (name: string, patch: Partial<ContextVariable>) => void
  removeVariable: (name: string) => void
  setContextValue: (name: string, value: ContextValue) => void
  validate: () => ValidationIssue[]
  sendEvent: (event: string, synthetic?: boolean) => void
  resetSimulation: () => void
  loadDocument: (document: MachineDocument | import('../types/machine').MachineDocumentLike) => void
  reset: () => void
}

const initial = sampleMachine()

function currentContext(variables: ContextVariable[]) {
  return Object.fromEntries(variables.map((variable) => [variable.name, variable.initial]))
}

/** 结构、转移或上下文定义改动后，正在跑的并行模拟作废，回到初始激活集合 */
function restartSimulation(state: MachineState) {
  state.activeStateIds = startEntries(state.nodes)
  state.context = currentContext(state.variables)
  state.trace = []
  state.simulationSeq += 1
  state.notice = '结构、转移或上下文已改动，正在运行的并行模拟已作废重算'
}

function findNode(state: MachineState, id: string) {
  return state.nodes.find((item) => item.id === id)
}

export const useMachineStore = create<MachineState>()(immer((set, get) => ({
  name: '费用申请审批状态机',
  nodes: initial.nodes,
  edges: initial.edges,
  variables: initial.variables,
  context: currentContext(initial.variables),
  activeStateIds: startEntries(initial.nodes),
  simulationSeq: 0,
  selectedNodeId: 'idle',
  selectedEdgeId: null,
  trace: [],
  issues: [],
  notice: '已加载并行审批流程示例：提交申请后风控与额度两条支路同时起步',

  setName: (name) => set((state: MachineState) => { state.name = name }),

  onNodesChange: (changes) => set((state: MachineState) => {
    state.nodes = applyNodeChanges(changes, state.nodes)
    // 移动、缩放只影响渲染；删除节点才作废模拟
    if (changes.some((change) => change.type === 'remove')) restartSimulation(state)
  }),

  onEdgesChange: (changes) => set((state: MachineState) => {
    const removed = changes.some((change) => change.type === 'remove')
    state.edges = applyEdgeChanges(changes, state.edges)
    if (removed) restartSimulation(state)
  }),

  connect: (connection) => set((state: MachineState) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const source = findNode(state, connection.source)
    const target = findNode(state, connection.target)
    // 复合状态不能作为子状态接入某条支路：进入复合状态时由每条支路的初始子状态起步
    if (target?.data.kind === 'compound' && target.parentId) {
      state.notice = '不能转入复合状态内部：请从根级转入，或选择具体子状态'
      return
    }
    // 从并行复合状态边框连出的是“全部支路完成”转移
    const event = source?.data.kind === 'compound' ? DONE_EVENT : 'NEXT'
    const edge: TransitionEdge = {
      ...connection,
      id: `transition-${Date.now().toString(36)}`,
      type: 'transition',
      data: { event, condition: '', action: '', assignments: [] },
    }
    state.edges = addEdge(edge, state.edges) as TransitionEdge[]
    state.selectedEdgeId = edge.id
    state.selectedNodeId = null
    state.notice = source?.data.kind === 'compound'
      ? '已创建完成转移：每条支路都到达结束后触发'
      : '已创建转移，请在属性面板配置事件'
    restartSimulation(state)
  }),

  addState: (kind, parentId = null) => set((state: MachineState) => {
    const parent = parentId ? findNode(state, parentId) : undefined
    if (parentId && (!parent || parent.data.kind !== 'compound')) return
    const branches = parent ? branchesOf(parent) : []
    const branchIndex = (branchValue: string) => Math.max(0, branches.findIndex((branch) => branch.id === branchValue))
    const targetBranch = branches[0]?.id
    const siblings = targetBranch
      ? state.nodes.filter((node) => node.parentId === parent?.id && branchOf(node, parent).id === targetBranch).length
      : 0
    const rootCount = state.nodes.filter((node) => !node.parentId).length
    const position = parent
      ? {
          x: 28 + branchIndex(targetBranch!) * 212,
          y: 70 + Math.floor(siblings / 2) * 120,
        }
      : { x: 80 + (rootCount % 4) * 240, y: 100 + Math.floor(rootCount / 4) * 180 }
    const stateNode = createState(kind === 'compound' ? '新复合状态' : kind === 'final' ? '结束状态' : '新状态', position, kind, parent?.id, targetBranch)
    if (kind === 'compound') stateNode.data.description = '可包含子状态的复合区域'
    state.nodes.push(stateNode)
    if (parent) {
      // 支路内第一个子状态自动标记为该支路初始
      if (siblings === 0) stateNode.data.initial = true
    } else if (kind === 'compound' && rootCount === 0) {
      stateNode.data.initial = true
    }
    state.selectedNodeId = stateNode.id
    state.selectedEdgeId = null
    state.notice = `已添加${kind === 'compound' ? '复合状态' : kind === 'final' ? '结束状态' : '状态'}`
    restartSimulation(state)
  }),

  selectNode: (id) => set((state: MachineState) => {
    state.selectedNodeId = id
    state.selectedEdgeId = null
  }),

  selectEdge: (id) => set((state: MachineState) => {
    state.selectedEdgeId = id
    state.selectedNodeId = null
  }),

  updateNode: (id, patch) => set((state: MachineState) => {
    const node = findNode(state, id)
    if (!node) return
    const structuralKeys: (keyof typeof patch)[] = ['kind', 'initial', 'parallel', 'branches', 'branchId']
    const structural = structuralKeys.some((key) => key in patch)
    node.data = { ...node.data, ...patch }
    if (node.data.kind === 'compound') node.data.isGroup = true
    if (structural) restartSimulation(state)
  }),

  updateEdge: (id, patch) => set((state: MachineState) => {
    const edge = state.edges.find((item) => item.id === id)
    if (!edge) return
    edge.data = {
      event: patch.event ?? edge.data?.event ?? 'NEXT',
      condition: patch.condition ?? edge.data?.condition ?? '',
      priority: patch.priority ?? edge.data?.priority,
      action: patch.action ?? edge.data?.action ?? '',
      assignments: patch.assignments ?? edge.data?.assignments ?? [],
    }
    // 转移一有改动，正在跑的并行模拟作废重算
    restartSimulation(state)
  }),

  deleteSelection: () => set((state: MachineState) => {
    if (state.selectedNodeId) {
      const id = state.selectedNodeId
      const removed = new Set<string>([id])
      // 连同各级子状态一起删除
      let frontier = [id]
      while (frontier.length) {
        const current = frontier.shift()!
        const children = state.nodes.filter((node) => node.parentId === current)
        children.forEach((child) => removed.add(child.id))
        frontier = [...frontier, ...children.map((child) => child.id)]
      }
      state.nodes = state.nodes.filter((node) => !removed.has(node.id))
      state.edges = state.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
      state.selectedNodeId = null
      restartSimulation(state)
    } else if (state.selectedEdgeId) {
      state.edges = state.edges.filter((edge) => edge.id !== state.selectedEdgeId)
      state.selectedEdgeId = null
      restartSimulation(state)
    }
  }),

  setInitial: (id) => set((state: MachineState) => {
    const node = findNode(state, id)
    if (!node) return
    if (node.parentId) {
      const parent = findNode(state, node.parentId)
      const branchValue = branchOf(node, parent).id
      // 每条支路各自有一个初始子状态
      state.nodes
        .filter((item) => item.parentId === node.parentId && branchOf(item, parent).id === branchValue)
        .forEach((item) => { item.data.initial = false })
    } else {
      state.nodes.filter((item) => !item.parentId).forEach((item) => { item.data.initial = false })
    }
    node.data.initial = true
    restartSimulation(state)
  }),

  addBranch: (compoundId) => set((state: MachineState) => {
    const compound = findNode(state, compoundId)
    if (!compound || compound.data.kind !== 'compound') return
    const branches = branchesOf(compound)
    const nextId = makeBranchId()
    const index = branches.length
    branches.push({ id: nextId, label: `支路 ${index + 1}` })
    compound.data.branches = branches
    compound.data.parallel = true
    // 新支路自带一对“处理中 → 结束”子状态，立即可以参与并行
    const laneX = 28 + index * 212
    const working = createState('处理中', { x: laneX, y: 72 }, 'simple', compound.id, nextId)
    working.data.initial = true
    working.data.description = '新支路的初始子状态'
    const done = createState('支路结束', { x: laneX, y: 190 }, 'final', compound.id, nextId)
    done.data.description = '该支路执行完毕'
    state.nodes.push(working, done)
    state.edges.push({
      id: `transition-${Date.now().toString(36)}`,
      source: working.id,
      target: done.id,
      type: 'transition',
      data: { event: `BRANCH_${index + 1}_DONE`, condition: '', action: '', assignments: [] },
    })
    state.notice = `已为“${compound.data.label}”添加并行支路，进入时各支路从自己的初始子状态起步`
    restartSimulation(state)
  }),

  removeBranch: (compoundId, branchValue) => set((state: MachineState) => {
    const compound = findNode(state, compoundId)
    if (!compound || compound.data.kind !== 'compound') return
    const branches = branchesOf(compound)
    if (branches.length <= 1) {
      state.notice = '至少保留一条支路'
      return
    }
    const removed = new Set(state.nodes.filter((node) => node.parentId === compoundId && branchOf(node, compound).id === branchValue).map((node) => node.id))
    state.nodes = state.nodes.filter((node) => !removed.has(node.id))
    state.edges = state.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
    compound.data.branches = branches.filter((branch) => branch.id !== branchValue)
    if (compound.data.branches.length < 2) compound.data.parallel = false
    state.notice = '支路及其子状态已删除'
    restartSimulation(state)
  }),

  updateBranch: (compoundId, branchValue, patch) => set((state: MachineState) => {
    const compound = findNode(state, compoundId)
    if (!compound) return
    const branch = branchesOf(compound).find((item) => item.id === branchValue)
    if (branch && patch.label !== undefined) branch.label = patch.label
  }),

  setNodeBranch: (nodeId, branchValue) => set((state: MachineState) => {
    const node = findNode(state, nodeId)
    if (!node?.parentId) return
    const parent = findNode(state, node.parentId)
    if (!parent || !branchesOf(parent).some((branch) => branch.id === branchValue)) return
    node.data.branchId = branchValue
    restartSimulation(state)
  }),

  addVariable: () => set((state: MachineState) => {
    let index = state.variables.length + 1
    let name = `variable${index}`
    while (state.variables.some((item) => item.name === name)) name = `variable${++index}`
    state.variables.push({ name, type: 'number', initial: 0 })
    state.context[name] = 0
    restartSimulation(state)
  }),

  updateVariable: (name, patch) => set((state: MachineState) => {
    const variable = state.variables.find((item) => item.name === name)
    if (!variable) return
    const previousName = variable.name
    Object.assign(variable, patch)
    if (patch.name && patch.name !== previousName) {
      state.context[patch.name] = state.context[previousName] ?? variable.initial
      delete state.context[previousName]
    }
    if (patch.initial !== undefined) state.context[variable.name] = patch.initial
    // 上下文定义（类型、初值、变量）改动同样作废重算
    restartSimulation(state)
  }),

  removeVariable: (name) => set((state: MachineState) => {
    state.variables = state.variables.filter((variable) => variable.name !== name)
    delete state.context[name]
    restartSimulation(state)
  }),

  setContextValue: (name, value) => set((state: MachineState) => { state.context[name] = value }),

  validate: () => {
    const issues = validateMachine(get().nodes, get().edges)
    set((state: MachineState) => {
      state.issues = issues
      state.notice = issues.length ? `校验发现 ${issues.length} 个问题` : '校验通过：状态机结构完整'
    })
    return issues
  },

  sendEvent: (event, synthetic = false) => {
    const state = get()
    if (!state.activeStateIds.length) {
      set((draft: MachineState) => { draft.notice = '模拟尚未进入任何状态' })
      return
    }
    const result = stepEvent(event, state.activeStateIds, state.nodes, state.edges, state.context)
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const acceptedCount = result.drafts.filter((draft) => draft.accepted).length
    const hasConflict = result.drafts.some((draft) => draft.conflict)
    set((draft: MachineState) => {
      draft.context = result.context
      draft.activeStateIds = result.activeIds
      result.drafts.forEach((item) => {
        draft.trace.push({ id: sendEventId(), timestamp, ...item })
      })
      if (!acceptedCount) {
        draft.notice = `事件 ${event} 未触发任何支路${hasConflict ? '（存在守卫冲突）' : ''}`
      } else {
        const targets = result.drafts.filter((item) => item.accepted).map((item) => state.nodes.find((node) => node.id === item.to)?.data.label ?? item.to)
        draft.notice = synthetic
          ? `模拟执行：${[...new Set(targets)].join('、')}`
          : `事件 ${event} 已分发给所有激活支路，${acceptedCount} 条转移命中${hasConflict ? '，另有守卫冲突' : ''}`
      }
    })
  },

  resetSimulation: () => set((state: MachineState) => {
    state.activeStateIds = startEntries(state.nodes)
    state.context = currentContext(state.variables)
    state.trace = []
    state.simulationSeq += 1
    state.notice = '模拟已回到初始状态：每条并行支路从各自初始子状态重新起步'
  }),

  loadDocument: (document) => set((state: MachineState) => {
    const migrated = migrateDocument(document)
    state.name = migrated.name
    state.nodes = migrated.nodes
    state.edges = migrated.edges
    state.variables = migrated.variables
    state.context = currentContext(migrated.variables)
    state.selectedNodeId = null
    state.selectedEdgeId = null
    state.activeStateIds = startEntries(migrated.nodes)
    state.trace = []
    state.simulationSeq += 1
    state.notice = (document.version ?? 1) < 2
      ? '旧版单支路数据已升级：原复合状态补成一条并行支路'
      : '状态机 JSON 已导入'
  }),

  reset: () => set((state: MachineState) => {
    const fresh = sampleMachine()
    state.name = '费用申请审批状态机'
    state.nodes = fresh.nodes
    state.edges = fresh.edges
    state.variables = fresh.variables
    state.context = currentContext(fresh.variables)
    state.activeStateIds = startEntries(fresh.nodes)
    state.selectedNodeId = 'idle'
    state.selectedEdgeId = null
    state.trace = []
    state.issues = []
    state.simulationSeq += 1
    state.notice = '已恢复并行审批流程示例'
  }),
})))

export type { MachineState }
