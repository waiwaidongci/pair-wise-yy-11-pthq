import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AccountTreeOutlined, FlagOutlined, PlayCircle, StopOutlined } from '@mui/icons-material'
import type { StateNode } from '../types/machine'
import { branchesOf, branchOf } from '../utils/machine'
import { useMachineStore } from '../stores/machine'

export default function StateNodeCard({ id, data, selected, parentId }: NodeProps<StateNode>) {
  const activeStateIds = useMachineStore((state) => state.activeStateIds)
  const nodes = useMachineStore((state) => state.nodes)
  const isActive = activeStateIds.includes(id)

  if (data.isGroup) {
    const branches = branchesOf({ id, data } as StateNode)
    const completed = branches.every((branch) => {
      const leafId = activeStateIds.find((activeId) => {
        const active = nodes.find((node) => node.id === activeId)
        return active?.parentId === id && branchOf(active, { id, data } as StateNode).id === branch.id
      })
      return nodes.find((node) => node.id === leafId)?.data.kind === 'final'
    })
    return (
      <div className={`state-node compound-node ${selected ? 'selected' : ''} ${completed ? 'completed-node' : ''}`}>
        <Handle id="in" type="target" position={Position.Left} className="state-handle compound-handle" />
        <div className="compound-title">
          <span>{data.label}</span>
          <small>
            {data.parallel ? <><AccountTreeOutlined sx={{ fontSize: 12, verticalAlign: -2 }} /> 并行 · {branches.length} 条支路</> : `复合状态 · ${branches.length} 条支路`}
            {completed && ' · 全部完成'}
          </small>
        </div>
        <div className="compound-body">
          {branches.map((branch, index) => (
            <span key={branch.id} className={`branch-tag branch-color-${index % 4}`}>{branch.label}</span>
          ))}
        </div>
        <Handle id="out" type="source" position={Position.Right} className="state-handle compound-handle" />
      </div>
    )
  }

  const parent = parentId ? nodes.find((node) => node.id === parentId) : undefined
  const branchColor = parent ? branchesOf(parent).findIndex((branch) => branch.id === branchOf({ id, data, parentId } as StateNode, parent).id) % 4 : -1
  return (
    <div className={`state-node ${data.kind === 'final' ? 'final-node' : ''} ${data.initial ? 'initial-node' : ''} ${selected ? 'selected' : ''} ${isActive ? 'current-node' : ''}`}>
      <Handle id="in" type="target" position={Position.Left} className="state-handle" />
      {data.initial && <div className="initial-marker"><PlayCircle /></div>}
      <div className="state-kind">
        {data.kind === 'final' ? <><StopOutlined /> final</> : <><FlagOutlined /> state</>}
      </div>
      <strong>{data.label}</strong>
      <p>{data.description || '右键配置状态说明与实际业务含义'}</p>
      {parent && (
        <span className={`child-branch branch-color-${branchColor}`}>
          {branchOf({ id, data, parentId } as StateNode, parent).label}
        </span>
      )}
      {isActive && <span className="current-label">ACTIVE</span>}
      <Handle id="out" type="source" position={Position.Right} className="state-handle" />
    </div>
  )
}
