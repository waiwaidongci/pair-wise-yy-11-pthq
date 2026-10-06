import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FlagOutlined, PlayCircle, StopOutlined } from '@mui/icons-material'
import type { StateNode } from '../types/machine'
import { useMachineStore } from '../stores/machine'
import { branchIdOf, getBranches } from '../utils/machine'

export default function StateNodeCard({ id, data, selected }: NodeProps<StateNode>) {
  const activeStateIds = useMachineStore((state) => state.activeStateIds)
  const nodes = useMachineStore((state) => state.nodes)
  const isCurrent = activeStateIds.includes(id)
  const node = nodes.find((item) => item.id === id)
  if (data.isGroup) {
    const branches = getBranches(nodes, id)
    return (
      <div className={`state-node compound-node ${selected ? 'selected' : ''}`}>
        <div className="compound-title"><span>{data.label}</span><small>并行复合状态 · {branches.length} 条支路</small></div>
        <div className="compound-body">
          {branches.length ? (
            <div className="branch-chips">
              {branches.map((branch, index) => (
                <span key={branch.branchId} className="branch-chip">支路 {index + 1} · {branch.nodes.length} 个子状态</span>
              ))}
            </div>
          ) : '子状态区域'}
        </div>
      </div>
    )
  }
  const branchLabel = node?.parentId
    ? `支路 ${getBranches(nodes, node.parentId).findIndex((b) => b.branchId === branchIdOf(data)) + 1}`
    : null
  return (
    <div className={`state-node ${data.kind === 'final' ? 'final-node' : ''} ${data.initial ? 'initial-node' : ''} ${selected ? 'selected' : ''} ${isCurrent ? 'current-node' : ''}`}>
      <Handle id="in" type="target" position={Position.Left} className="state-handle" />
      {data.initial && <div className="initial-marker"><PlayCircle /></div>}
      <div className="state-kind">
        {data.kind === 'final' ? <><StopOutlined /> final</> : <><FlagOutlined /> state</>}
        {branchLabel && <span className="branch-tag">{branchLabel}</span>}
      </div>
      <strong>{data.label}</strong>
      <p>{data.description || '右键配置状态说明与实际业务含义'}</p>
      {isCurrent && <span className="current-label">CURRENT</span>}
      <Handle id="out" type="source" position={Position.Right} className="state-handle" />
    </div>
  )
}
