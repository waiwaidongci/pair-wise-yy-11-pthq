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
  branchId,
  branchIdOf,
  createState,
  getBranches,
  initialActiveStates,
  isCompoundDone,
  migrateDocument,
  sampleMachine,
  sendEventId,
  simulateEvent,
  validateMachine,
} from '../utils/machine'

interface MachineState {
  name: string
  nodes: StateNode[]
  edges: TransitionEdge[]
  variables: ContextVariable[]
  context: Record<string, ContextValue>
  /** 当前激活的所有状态（含复合状态及其各支路的叶子状态） */
  activeStateIds: string[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /** 复合状态下当前选中的并行支路，用于新增子状态 */
  selectedBranchId: string | null
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
  selectBranch: (branchId: string | null) => void
  addVariable: () => void
  updateVariable: (name: string, patch: Partial<ContextVariable>) => void
  removeVariable: (name: string) => void
  setContextValue: (name: string, value: ContextValue) => void
  validate: () => ValidationIssue[]
  sendEvent: (event: string, synthetic?: boolean) => void
  resetSimulation: () => void
  loadDocument: (document: MachineDocument) => void
  reset: () => void
}

const initial = sampleMachine()

function currentContext(variables: ContextVariable[]) {
  return Object.fromEntries(variables.map((variable) => [variable.name, variable.initial]))
}

/** 结构改动后作废正在跑的并行模拟，回到初始激活配置重算 */
function invalidateSimulation(state: MachineState) {
  state.activeStateIds = initialActiveStates(state.nodes)
  state.trace = []
}

export const useMachineStore = create<MachineState>()(immer((set, get) => ({
  name: '费用申请审批状态机',
  nodes: initial.nodes,
  edges: initial.edges,
  variables: initial.variables,
  context: currentContext(initial.variables),
  activeStateIds: initialActiveStates(initial.nodes),
  selectedNodeId: 'idle',
  selectedEdgeId: null,
  selectedBranchId: null,
  trace: [],
  issues: [],
  notice: '已加载审批流程示例',

  setName: (name) => set((state: MachineState) => { state.name = name }),

  onNodesChange: (changes) => set((state: MachineState) => {
    state.nodes = applyNodeChanges(changes, state.nodes)
    if (changes.some((change) => change.type === 'add' || change.type === 'remove')) invalidateSimulation(state)
  }),

  onEdgesChange: (changes) => set((state: MachineState) => {
    state.edges = applyEdgeChanges(changes, state.edges)
    if (changes.some((change) => change.type === 'add' || change.type === 'remove')) invalidateSimulation(state)
  }),

  connect: (connection) => set((state: MachineState) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const edge: TransitionEdge = {
      ...connection,
      id: `transition-${Date.now().toString(36)}`,
      type: 'transition',
      data: { event: 'NEXT', condition: '', action: '', assignments: [] },
    }
    state.edges = addEdge(edge, state.edges) as TransitionEdge[]
    state.selectedEdgeId = edge.id
    state.selectedNodeId = null
    invalidateSimulation(state)
    state.notice = '已创建转移，请在属性面板配置事件'
  }),

  addState: (kind, parentId = null) => set((state: MachineState) => {
    const parent = parentId ? state.nodes.find((node) => node.id === parentId && node.data.kind === 'compound') : undefined
    const siblings = state.nodes.filter((node) => node.parentId === parent?.id).length
    const rootCount = state.nodes.filter((node) => !node.parentId).length
    const position = parent
      ? { x: 35 + (siblings % 2) * 190, y: 90 + Math.floor(siblings / 2) * 95 }
      : { x: 80 + (rootCount % 4) * 240, y: 100 + Math.floor(rootCount / 4) * 180 }
    const stateNode = createState(kind === 'compound' ? '新复合状态' : kind === 'final' ? '结束状态' : '新状态', position, kind, parent?.id)
    if (kind === 'compound') stateNode.data.description = '可包含多条并行支路的复合区域'
    // 子状态归入当前选中的支路（可能是尚未创建子状态的新支路），缺省取第一条支路
    if (parent) {
      const branches = getBranches(state.nodes, parent.id)
      stateNode.data.branchId = state.selectedBranchId ?? branches[0]?.branchId ?? branchId()
    }
    state.nodes.push(stateNode)
    if (kind === 'compound' && siblings === 0) stateNode.data.initial = true
    state.selectedNodeId = stateNode.id
    state.selectedEdgeId = null
    invalidateSimulation(state)
    state.notice = `已添加${kind === 'compound' ? '复合状态' : kind === 'final' ? '结束状态' : '状态'}`
  }),

  selectNode: (id) => set((state: MachineState) => {
    state.selectedNodeId = id
    state.selectedEdgeId = null
    // 选中复合状态时，默认选中其第一条支路
    if (id) {
      const node = state.nodes.find((item) => item.id === id)
      if (node?.data.kind === 'compound') {
        state.selectedBranchId = getBranches(state.nodes, id)[0]?.branchId ?? null
      } else {
        state.selectedBranchId = node?.data.branchId ?? null
      }
    } else {
      state.selectedBranchId = null
    }
  }),

  selectEdge: (id) => set((state: MachineState) => {
    state.selectedEdgeId = id
    state.selectedNodeId = null
  }),

  updateNode: (id, patch) => set((state: MachineState) => {
    const node = state.nodes.find((item) => item.id === id)
    if (node) {
      node.data = { ...node.data, ...patch }
      invalidateSimulation(state)
    }
  }),

  updateEdge: (id, patch) => set((state: MachineState) => {
    const edge = state.edges.find((item) => item.id === id)
    if (edge) {
      edge.data = {
        event: patch.event ?? edge.data?.event ?? 'NEXT',
        condition: patch.condition ?? edge.data?.condition ?? '',
        action: patch.action ?? edge.data?.action ?? '',
        assignments: patch.assignments ?? edge.data?.assignments ?? [],
      }
      invalidateSimulation(state)
    }
  }),

  deleteSelection: () => set((state: MachineState) => {
    if (state.selectedNodeId) {
      const id = state.selectedNodeId
      const childIds = state.nodes.filter((node) => node.parentId === id).map((node) => node.id)
      state.nodes = state.nodes.filter((node) => node.id !== id && node.parentId !== id)
      const removed = new Set([id, ...childIds])
      state.edges = state.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
      state.selectedNodeId = null
      invalidateSimulation(state)
    } else if (state.selectedEdgeId) {
      state.edges = state.edges.filter((edge) => edge.id !== state.selectedEdgeId)
      state.selectedEdgeId = null
      invalidateSimulation(state)
    }
  }),

  setInitial: (id) => set((state: MachineState) => {
    const node = state.nodes.find((item) => item.id === id)
    if (!node) return
    // 同一支路内仅允许一个初始子状态
    state.nodes
      .filter((item) => item.parentId === node.parentId && branchIdOf(item) === branchIdOf(node))
      .forEach((item) => { item.data.initial = false })
    node.data.initial = true
    invalidateSimulation(state)
  }),

  addBranch: (compoundId) => set((state: MachineState) => {
    const compound = state.nodes.find((node) => node.id === compoundId && node.data.kind === 'compound')
    if (!compound) return
    const newBranchId = branchId()
    state.selectedBranchId = newBranchId
    state.notice = '已添加并行支路，请在该支路上添加子状态'
  }),

  removeBranch: (compoundId, targetBranchId) => set((state: MachineState) => {
    const compound = state.nodes.find((node) => node.id === compoundId && node.data.kind === 'compound')
    if (!compound) return
    const branches = getBranches(state.nodes, compoundId)
    if (branches.length <= 1) return
    const branchNodeIds = new Set(
      state.nodes.filter((node) => node.parentId === compoundId && branchIdOf(node) === targetBranchId).map((node) => node.id),
    )
    state.nodes = state.nodes.filter((node) => !branchNodeIds.has(node.id))
    state.edges = state.edges.filter((edge) => !branchNodeIds.has(edge.source) && !branchNodeIds.has(edge.target))
    if (state.selectedBranchId === targetBranchId) {
      state.selectedBranchId = branches.find((b) => b.branchId !== targetBranchId)?.branchId ?? null
    }
    invalidateSimulation(state)
    state.notice = '已删除并行支路'
  }),

  selectBranch: (targetBranchId) => set((state: MachineState) => {
    state.selectedBranchId = targetBranchId
  }),

  addVariable: () => set((state: MachineState) => {
    let index = state.variables.length + 1
    let name = `variable${index}`
    while (state.variables.some((item) => item.name === name)) name = `variable${++index}`
    state.variables.push({ name, type: 'number', initial: 0 })
    state.context[name] = 0
    invalidateSimulation(state)
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
    invalidateSimulation(state)
  }),

  removeVariable: (name) => set((state: MachineState) => {
    state.variables = state.variables.filter((variable) => variable.name !== name)
    delete state.context[name]
    invalidateSimulation(state)
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
    const { activeIds, entries } = simulateEvent(
      state.nodes,
      state.edges,
      { ...state.context },
      state.activeStateIds,
      event,
      sendEventId,
    )
    const accepted = entries.some((entry) => entry.accepted)
    const last = entries[entries.length - 1]
    set((draft: MachineState) => {
      draft.activeStateIds = activeIds
      draft.context = last?.contextAfter ?? draft.context
      draft.trace.push(...entries.map((entry) => ({
        ...entry,
        contextAfter: JSON.parse(JSON.stringify(entry.contextAfter)) as Record<string, ContextValue>,
      })))
      const doneCompounds = state.nodes
        .filter((node) => node.data.kind === 'compound' && activeIds.includes(node.id) && isCompoundDone(state.nodes, node.id, new Set(activeIds)))
        .map((node) => node.data.label)
      if (accepted) {
        const targets = entries.filter((entry) => entry.accepted).map((entry) => {
          const target = state.nodes.find((node) => node.id === entry.to)
          return target?.data.label ?? entry.to
        })
        draft.notice = synthetic
          ? `模拟执行：${targets.join('、')}`
          : `事件 ${event} 已触发，进入 ${targets.join('、')}${doneCompounds.length ? `；复合状态 ${doneCompounds.join('、')} 各支路均已结束` : ''}`
      } else {
        draft.notice = `事件 ${event} 未触发：${last?.reason ?? '当前激活状态均未订阅该事件'}`
      }
    })
  },

  resetSimulation: () => set((state: MachineState) => {
    state.activeStateIds = initialActiveStates(state.nodes)
    state.context = currentContext(state.variables)
    state.trace = []
    state.notice = '模拟已回到初始状态'
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
    state.selectedBranchId = null
    state.activeStateIds = initialActiveStates(migrated.nodes)
    state.trace = []
    state.notice = '状态机 JSON 已导入'
  }),

  reset: () => set((state: MachineState) => {
    const fresh = sampleMachine()
    state.name = '费用申请审批状态机'
    state.nodes = fresh.nodes
    state.edges = fresh.edges
    state.variables = fresh.variables
    state.context = currentContext(fresh.variables)
    state.activeStateIds = initialActiveStates(fresh.nodes)
    state.selectedNodeId = 'idle'
    state.selectedEdgeId = null
    state.selectedBranchId = null
    state.trace = []
    state.issues = []
    state.notice = '已恢复审批流程示例'
  }),
})))
