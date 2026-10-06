import {
  branchId,
  createState,
  initialActiveStates,
  isCompoundDone,
  migrateDocument,
  simulateEvent,
  xstateConfig,
} from '../src/utils/machine'
import type { MachineDocument, StateNode, TransitionEdge } from '../src/types/machine'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.error(`  ✗ ${message}`)
  }
}

function makeId() {
  return `evt-${Math.random().toString(36).slice(2, 8)}`
}

// 构建一个带两条并行支路的复合状态机
function buildParallelMachine() {
  const nodes: StateNode[] = []
  const edges: TransitionEdge[] = []

  const compound = createState('审批', { x: 0, y: 0 }, 'compound')
  compound.id = 'approval'
  compound.data.initial = true
  nodes.push(compound)

  // 支路1：风控
  const b1 = branchId()
  const riskStart = createState('风控初审', { x: 0, y: 0 }, 'simple', 'approval')
  riskStart.id = 'risk-start'
  riskStart.data.branchId = b1
  riskStart.data.initial = true
  const riskEnd = createState('风控完成', { x: 0, y: 0 }, 'final', 'approval')
  riskEnd.id = 'risk-end'
  riskEnd.data.branchId = b1
  nodes.push(riskStart, riskEnd)

  // 支路2：额度
  const b2 = branchId()
  const quotaStart = createState('额度初审', { x: 0, y: 0 }, 'simple', 'approval')
  quotaStart.id = 'quota-start'
  quotaStart.data.branchId = b2
  quotaStart.data.initial = true
  const quotaEnd = createState('额度完成', { x: 0, y: 0 }, 'final', 'approval')
  quotaEnd.id = 'quota-end'
  quotaEnd.data.branchId = b2
  nodes.push(quotaStart, quotaEnd)

  // 支路3：资方（用于测试多条）
  const b3 = branchId()
  const fundStart = createState('资方初审', { x: 0, y: 0 }, 'simple', 'approval')
  fundStart.id = 'fund-start'
  fundStart.data.branchId = b3
  fundStart.data.initial = true
  const fundEnd = createState('资方完成', { x: 0, y: 0 }, 'final', 'approval')
  fundEnd.id = 'fund-end'
  fundEnd.data.branchId = b3
  nodes.push(fundStart, fundEnd)

  // 转移：每条支路各自的事件
  edges.push(
    { id: 'e1', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'RISK_DONE', condition: '', action: '', assignments: [] } },
    { id: 'e2', source: 'quota-start', target: 'quota-end', type: 'transition', data: { event: 'QUOTA_DONE', condition: '', action: '', assignments: [] } },
    { id: 'e3', source: 'fund-start', target: 'fund-end', type: 'transition', data: { event: 'FUND_DONE', condition: '', action: '', assignments: [] } },
  )

  return { nodes, edges, b1, b2, b3 }
}

console.log('测试1：进入复合状态时每条支路从各自初始状态起步')
{
  const { nodes, edges } = buildParallelMachine()
  const active = initialActiveStates(nodes)
  assert(active.includes('approval'), '复合状态已激活')
  assert(active.includes('risk-start'), '支路1初始状态已激活')
  assert(active.includes('quota-start'), '支路2初始状态已激活')
  assert(active.includes('fund-start'), '支路3初始状态已激活')
  assert(!active.includes('risk-end'), '支路1结束状态未激活')
}

console.log('\n测试2：事件广播给所有激活支路，各支路独立推进')
{
  const { nodes, edges } = buildParallelMachine()
  let active = initialActiveStates(nodes)
  let context = {}

  // 只推进风控支路
  const r1 = simulateEvent(nodes, edges, context, active, 'RISK_DONE', makeId)
  active = r1.activeIds
  context = r1.entries[r1.entries.length - 1].contextAfter
  assert(active.includes('risk-end'), '风控支路到达结束')
  assert(active.includes('quota-start'), '额度支路仍在初始')
  assert(active.includes('fund-start'), '资方支路仍在初始')
  assert(!isCompoundDone(nodes, 'approval', new Set(active)), '复合状态未完成（还有支路未结束）')

  // 推进额度支路
  const r2 = simulateEvent(nodes, edges, context, active, 'QUOTA_DONE', makeId)
  active = r2.activeIds
  context = r2.entries[r2.entries.length - 1].contextAfter
  assert(active.includes('quota-end'), '额度支路到达结束')
  assert(active.includes('fund-start'), '资方支路仍在初始（不被拖住）')
  assert(!isCompoundDone(nodes, 'approval', new Set(active)), '复合状态仍未完成')

  // 推进资方支路
  const r3 = simulateEvent(nodes, edges, context, active, 'FUND_DONE', makeId)
  active = r3.activeIds
  assert(active.includes('fund-end'), '资方支路到达结束')
  assert(isCompoundDone(nodes, 'approval', new Set(active)), '所有支路结束，复合状态完成')
}

console.log('\n测试3：同一事件在同一条支路上命中多条转移时按守卫优先级取一条')
{
  const { nodes, edges } = buildParallelMachine()
  // 给风控支路加两条同事件不同守卫的转移
  edges.push(
    { id: 'g1', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'CHECK', condition: 'score > 60', action: '高分通过', assignments: [] } },
    { id: 'g2', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'CHECK', condition: 'score <= 60', action: '低分通过', assignments: [] } },
  )
  const active = initialActiveStates(nodes)
  const context = { score: 80 }
  const r = simulateEvent(nodes, edges, context, active, 'CHECK', makeId)
  const accepted = r.entries.filter((e) => e.accepted)
  assert(accepted.length === 1, '只命中一条转移')
  assert(accepted[0].action === '高分通过', '按守卫优先级取了高分分支')
}

console.log('\n测试4：多条转移守卫排不出先后时在轨迹里标出冲突')
{
  const { nodes, edges } = buildParallelMachine()
  // 两条守卫都为真，排不出先后
  edges.push(
    { id: 'c1', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'CHECK', condition: 'score > 0', action: '分支A', assignments: [] } },
    { id: 'c2', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'CHECK', condition: 'score > 10', action: '分支B', assignments: [] } },
  )
  const active = initialActiveStates(nodes)
  const context = { score: 80 }
  const r = simulateEvent(nodes, edges, context, active, 'CHECK', makeId)
  const accepted = r.entries.filter((e) => e.accepted)
  assert(accepted.length === 1, '仍取一条转移执行')
  assert(accepted[0].conflict === true, '轨迹中标出冲突')
  assert((accepted[0].conflictEdges?.length ?? 0) === 2, '冲突转移 id 已记录')
}

console.log('\n测试5：有守卫优先于无守卫')
{
  const { nodes, edges } = buildParallelMachine()
  edges.push(
    { id: 'u1', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'CHECK', condition: '', action: '无条件', assignments: [] } },
    { id: 'u2', source: 'risk-start', target: 'risk-end', type: 'transition', data: { event: 'CHECK', condition: 'score > 60', action: '有条件', assignments: [] } },
  )
  const active = initialActiveStates(nodes)
  const context = { score: 80 }
  const r = simulateEvent(nodes, edges, context, active, 'CHECK', makeId)
  const accepted = r.entries.filter((e) => e.accepted)
  assert(accepted[0].action === '有条件', '有守卫优先于无守卫')
}

console.log('\n测试6：旧版单支路文档升级为并行结构')
{
  const doc: MachineDocument = {
    version: 1,
    name: '旧机器',
    nodes: [
      { id: 'idle', type: 'state', position: { x: 0, y: 0 }, data: { label: '待提交', kind: 'simple', description: '', initial: true } },
      { id: 'approval', type: 'state', position: { x: 0, y: 0 }, data: { label: '审批', kind: 'compound', description: '', initial: false }, style: { width: 460, height: 310 } },
      { id: 'a', type: 'state', position: { x: 0, y: 0 }, data: { label: '子状态A', kind: 'simple', description: '', initial: true }, parentId: 'approval', extent: 'parent', expandParent: true },
      { id: 'b', type: 'state', position: { x: 0, y: 0 }, data: { label: '子状态B', kind: 'final', description: '', initial: false }, parentId: 'approval', extent: 'parent', expandParent: true },
    ],
    edges: [],
    variables: [],
    savedAt: '',
  }
  const migrated = migrateDocument(doc)
  assert(migrated.version === 2, '版本号升级为 2')
  const childA = migrated.nodes.find((n) => n.id === 'a')
  const childB = migrated.nodes.find((n) => n.id === 'b')
  assert(childA?.data.branchId === 'default', '子状态A 补 branchId')
  assert(childB?.data.branchId === 'default', '子状态B 补 branchId')
}

console.log('\n测试7：导出的 XState 配置按并行结构写')
{
  const { nodes, edges } = buildParallelMachine()
  const config = xstateConfig(nodes, edges, []) as Record<string, any>
  const approval = config.states.approval
  assert(approval.type === 'parallel', '复合状态导出为 parallel 类型')
  assert(approval.states.region_branch_1 !== undefined || Object.keys(approval.states).length === 3, '包含 3 个区域')
  const regionKeys = Object.keys(approval.states)
  assert(regionKeys.length === 3, '3 条支路对应 3 个区域')
  const firstRegion = approval.states[regionKeys[0]]
  assert(firstRegion.initial !== undefined, '每个区域有自己的 initial')
}

console.log('\n测试8：事件不被任何状态订阅时忽略')
{
  const { nodes, edges } = buildParallelMachine()
  const active = initialActiveStates(nodes)
  const r = simulateEvent(nodes, edges, {}, active, 'UNKNOWN_EVENT', makeId)
  assert(r.entries.every((e) => !e.accepted), '未知事件被忽略')
  assert(r.entries.some((e) => e.reason?.includes('未订阅')), '记录忽略原因')
}

console.log('\n测试9：上下文赋值在支路间共享')
{
  const { nodes, edges } = buildParallelMachine()
  // 替换风控支路的 RISK_DONE 转移，加上赋值
  const riskEdge = edges.find((e) => e.source === 'risk-start' && e.data.event === 'RISK_DONE')!
  riskEdge.data.assignments = [{ variable: 'riskCount', expression: 'riskCount + 1' }]
  const active = initialActiveStates(nodes)
  const context = { riskCount: 0 }
  const r = simulateEvent(nodes, edges, context, active, 'RISK_DONE', makeId)
  assert(r.entries[r.entries.length - 1].contextAfter.riskCount === 1, '赋值已应用到共享上下文')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
