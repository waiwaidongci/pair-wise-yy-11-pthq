import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import { PlayArrowOutlined, RestartAlt, WarningAmberOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useMachineStore } from '../stores/machine'
import { branchLabelOf } from '../utils/machine'

export default function SimulationPanel() {
  const store = useMachineStore()
  const [customEvent, setCustomEvent] = useState('')
  const activeNodes = store.activeStateIds.map((id) => store.nodes.find((node) => node.id === id)).filter((node): node is NonNullable<typeof node> => Boolean(node))
  const events = [...new Set(store.edges
    .filter((edge) => store.activeStateIds.includes(edge.source))
    .map((edge) => String(edge.data?.event ?? ''))
    .filter((event) => event))]

  return (
    <section className="simulation-panel">
      <div className="simulation-head">
        <div>
          <Typography variant="subtitle2">并行状态模拟器</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.3 }}>
            {activeNodes.length === 0 && <Typography variant="caption" color="text.secondary">未进入状态</Typography>}
            {activeNodes.map((node) => {
              const label = branchLabelOf(node, store.nodes)
              return (
                <Chip
                  key={node.id}
                  size="small"
                  color={node.data.kind === 'final' ? 'success' : 'primary'}
                  label={label ? `${label} · ${node.data.label}` : node.data.label}
                />
              )
            })}
          </Box>
        </div>
        <Stack direction="row" spacing={0.6} alignItems="center">
          <Chip size="small" label={`事件轨迹 ${store.trace.length}`} />
          <Button size="small" startIcon={<RestartAlt />} onClick={store.resetSimulation}>重置</Button>
        </Stack>
      </div>
      <Stack direction="row" spacing={0.7} sx={{ my: 1, flexWrap: 'wrap' }}>
        {events.map((event) => event && <Button key={event} size="small" variant="contained" startIcon={<PlayArrowOutlined />} onClick={() => store.sendEvent(event)}>{event}</Button>)}
        <TextField size="small" label="自定义事件" value={customEvent} onChange={(event) => setCustomEvent(event.target.value.toUpperCase())} sx={{ width: 150 }} />
        <Button size="small" disabled={!customEvent} onClick={() => { store.sendEvent(customEvent); setCustomEvent('') }}>发送</Button>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          事件会广播给所有激活支路；某条支路先结束不影响其他支路
        </Typography>
      </Stack>
      <Box className="context-strip">
        {Object.entries(store.context).map(([name, value]) => (
          <label key={name}>
            <span>{name}</span>
            <input value={String(value)} onChange={(event) => {
              const variable = store.variables.find((item) => item.name === name)
              const next = variable?.type === 'number' ? Number(event.target.value) : variable?.type === 'boolean' ? event.target.value === 'true' : event.target.value
              store.setContextValue(name, next)
            }} />
          </label>
        ))}
      </Box>
      <div className="trace-list">
        {store.trace.length === 0 && <span className="empty-trace">发送事件后，这里会显示每条支路的完整执行轨迹；守卫优先级冲突会高亮标出。</span>}
        {[...store.trace].reverse().map((entry) => {
          const from = store.nodes.find((node) => node.id === entry.from)?.data.label ?? entry.from
          const to = store.nodes.find((node) => node.id === entry.to)?.data.label ?? entry.to
          return (
            <div key={entry.id} className={`trace-item ${entry.accepted ? 'accepted' : 'rejected'} ${entry.conflict ? 'conflict' : ''}`}>
              <span className="trace-time">{entry.timestamp}</span>
              <strong>{entry.event}</strong>
              <span className="trace-route">
                {entry.branchLabel && <em className="trace-branch">{entry.branchLabel}</em>}
                {entry.conflict && <WarningAmberOutlined sx={{ fontSize: 13, color: '#dc2626', verticalAlign: -2 }} />}
                {from} → {to}
              </span>
              <small>{entry.reason || [entry.condition, entry.action].filter(Boolean).join(' / ') || '无条件动作'}</small>
            </div>
          )
        })}
      </div>
    </section>
  )
}
