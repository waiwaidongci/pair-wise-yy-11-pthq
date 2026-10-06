import { Box, Button, Checkbox, Chip, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { DeleteOutline, FlagOutlined, PlaylistAddOutlined } from '@mui/icons-material'
import { useMachineStore } from '../stores/machine'
import { branchIdOf, getBranches } from '../utils/machine'

export default function MachineInspector() {
  const store = useMachineStore()
  const node = store.nodes.find((item) => item.id === store.selectedNodeId)
  const edge = store.edges.find((item) => item.id === store.selectedEdgeId)

  if (!node && !edge) {
    return <aside className="side-panel inspector"><Typography variant="subtitle2">属性面板</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>选择状态或转移后配置行为。</Typography></aside>
  }

  if (node) {
    const branches = node.data.kind === 'compound' ? getBranches(store.nodes, node.id) : []
    return (
      <aside className="side-panel inspector">
        <Typography variant="subtitle2">状态属性</Typography>
        <Stack spacing={1.2} sx={{ mt: 1.5 }}>
          <TextField label="状态名称" size="small" value={node.data.label} onChange={(event) => store.updateNode(node.id, { label: event.target.value })} />
          <TextField select label="状态类型" size="small" value={node.data.kind} onChange={(event) => store.updateNode(node.id, { kind: event.target.value as typeof node.data.kind })}>
            <MenuItem value="simple">普通状态</MenuItem>
            <MenuItem value="compound">复合状态（并行）</MenuItem>
            <MenuItem value="final">结束状态</MenuItem>
          </TextField>
          <TextField label="业务说明" size="small" multiline rows={3} value={node.data.description} onChange={(event) => store.updateNode(node.id, { description: event.target.value })} />
          <FormControlLabel
            control={<Checkbox size="small" checked={node.data.initial} onChange={(event) => event.target.checked && store.setInitial(node.id)} />}
            label="设为同级初始状态"
          />
          {node.data.kind === 'compound' && (
            <>
              <Button variant="outlined" startIcon={<FlagOutlined />} onClick={() => store.addState('simple', node.id)}>添加子状态</Button>
              <Box className="branch-manager">
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle2">并行支路</Typography>
                  <Button size="small" startIcon={<PlaylistAddOutlined />} onClick={() => store.addBranch(node.id)}>添加支路</Button>
                </Stack>
                {branches.length === 0 && <Typography variant="caption" color="text.secondary">暂无支路，添加子状态后自动创建。</Typography>}
                {branches.map((branch, index) => {
                  const isSelected = store.selectedBranchId === branch.branchId
                  return (
                    <Box
                      key={branch.branchId}
                      className={`branch-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => store.selectBranch(branch.branchId)}
                    >
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Chip size="small" label={`支路 ${index + 1}`} color={isSelected ? 'primary' : 'default'} variant={isSelected ? 'filled' : 'outlined'} />
                        <Stack direction="row" spacing={0.3}>
                          <Button size="small" onClick={() => store.addState('simple', node.id)}>加子状态</Button>
                          <IconButton size="small" color="error" disabled={branches.length <= 1} onClick={(event) => { event.stopPropagation(); store.removeBranch(node.id, branch.branchId) }}>
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {branch.nodes.map((child) => child.data.label).join(' → ') || '空支路'}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </>
          )}
          {node.parentId && (
            <Box className="sidebar-tip"><strong>所属支路</strong><span>第 {getBranches(store.nodes, node.parentId).findIndex((b) => b.branchId === branchIdOf(node)) + 1} 支路</span></Box>
          )}
          <Box className="sidebar-tip"><strong>状态 ID</strong><span>{node.id}</span></Box>
          <Button color="error" variant="outlined" startIcon={<DeleteOutline />} onClick={store.deleteSelection}>删除状态</Button>
        </Stack>
      </aside>
    )
  }

  if (!edge) return null
  const assignments = edge.data?.assignments ?? []
  return (
    <aside className="side-panel inspector">
      <Typography variant="subtitle2">转移属性</Typography>
      <Stack spacing={1.2} sx={{ mt: 1.5 }}>
        <TextField label="事件名称" size="small" value={edge.data?.event ?? ''} onChange={(event) => store.updateEdge(edge.id, { event: event.target.value.toUpperCase() })} />
        <TextField label="守卫条件" size="small" placeholder="例：amount > 5000" value={edge.data?.condition ?? ''} onChange={(event) => store.updateEdge(edge.id, { condition: event.target.value })} />
        <TextField label="动作说明" size="small" value={edge.data?.action ?? ''} onChange={(event) => store.updateEdge(edge.id, { action: event.target.value })} />
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2">上下文赋值</Typography>
          <Button size="small" onClick={() => store.updateEdge(edge.id, { assignments: [...assignments, { variable: store.variables[0]?.name ?? '', expression: '0' }] })}>添加</Button>
        </Stack>
        {assignments.map((assignment, index) => (
          <Box key={`${index}-${assignment.variable}`} className="assignment-row">
            <TextField
              select
              size="small"
              value={assignment.variable}
              onChange={(event) => {
                const next = assignments.map((item, itemIndex) => itemIndex === index ? { ...item, variable: event.target.value } : item)
                store.updateEdge(edge.id, { assignments: next })
              }}
            >
              {store.variables.map((variable) => <MenuItem key={variable.name} value={variable.name}>{variable.name}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              label="表达式"
              value={assignment.expression}
              onChange={(event) => {
                const next = assignments.map((item, itemIndex) => itemIndex === index ? { ...item, expression: event.target.value } : item)
                store.updateEdge(edge.id, { assignments: next })
              }}
            />
            <IconButton size="small" color="error" onClick={() => store.updateEdge(edge.id, { assignments: assignments.filter((_, itemIndex) => itemIndex !== index) })}>
              <DeleteOutline fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button color="error" variant="outlined" startIcon={<DeleteOutline />} onClick={store.deleteSelection}>删除转移</Button>
      </Stack>
    </aside>
  )
}
