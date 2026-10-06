import { Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { Add, DeleteOutline, FlagOutlined } from '@mui/icons-material'
import { useMachineStore } from '../stores/machine'
import { branchOf, branchesOf } from '../utils/machine'

export default function MachineInspector() {
  const store = useMachineStore()
  const node = store.nodes.find((item) => item.id === store.selectedNodeId)
  const edge = store.edges.find((item) => item.id === store.selectedEdgeId)

  if (!node && !edge) {
    return <aside className="side-panel inspector"><Typography variant="subtitle2">属性面板</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>选择状态或转移后配置行为。</Typography></aside>
  }

  if (node) {
    const parent = node.parentId ? store.nodes.find((item) => item.id === node.parentId) : undefined
    const branches = node.data.kind === 'compound' ? branchesOf(node) : []
    return (
      <aside className="side-panel inspector">
        <Typography variant="subtitle2">状态属性</Typography>
        <Stack spacing={1.2} sx={{ mt: 1.5 }}>
          <TextField label="状态名称" size="small" value={node.data.label} onChange={(event) => store.updateNode(node.id, { label: event.target.value })} />
          <TextField select label="状态类型" size="small" value={node.data.kind} onChange={(event) => store.updateNode(node.id, { kind: event.target.value as typeof node.data.kind })}>
            <MenuItem value="simple">普通状态</MenuItem>
            <MenuItem value="compound">复合状态</MenuItem>
            <MenuItem value="final">结束状态</MenuItem>
          </TextField>
          <TextField label="业务说明" size="small" multiline rows={3} value={node.data.description} onChange={(event) => store.updateNode(node.id, { description: event.target.value })} />
          <FormControlLabel
            control={<Checkbox size="small" checked={node.data.initial} onChange={(event) => event.target.checked && store.setInitial(node.id)} />}
            label={parent ? '设为本支路初始子状态' : '设为根初始状态'}
          />

          {parent?.data.kind === 'compound' && (
            <TextField
              select
              size="small"
              label="所属支路"
              value={branchOf(node, parent).id}
              onChange={(event) => store.setNodeBranch(node.id, event.target.value)}
            >
              {branchesOf(parent).map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.label}</MenuItem>)}
            </TextField>
          )}

          {node.data.kind === 'compound' && (
            <>
              <FormControlLabel
                control={<Checkbox size="small" checked={Boolean(node.data.parallel)} onChange={(event) => store.updateNode(node.id, { parallel: event.target.checked })} />}
                label="多条支路并行（进入时各支路同时起步）"
              />
              <Box className="branch-editor">
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle2">并行支路</Typography>
                  <Button size="small" startIcon={<Add />} onClick={() => store.addBranch(node.id)}>添加支路</Button>
                </Stack>
                {branches.map((branch, index) => (
                  <Box key={branch.id} className="branch-row">
                    <span className={`branch-dot branch-color-${index % 4}`} />
                    <TextField
                      size="small"
                      value={branch.label}
                      onChange={(event) => store.updateBranch(node.id, branch.id, { label: event.target.value })}
                    />
                    <IconButton
                      size="small"
                      color="error"
                      disabled={branches.length <= 1}
                      onClick={() => store.removeBranch(node.id, branch.id)}
                    >
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
                <Typography variant="caption" color="text.secondary">
                  每条支路需有自己标了初始的子状态；所有支路都到达结束后，从复合状态边框连出的 DONE 转移才会触发。
                </Typography>
              </Box>
              <Button variant="outlined" startIcon={<FlagOutlined />} onClick={() => store.addState('simple', node.id)}>添加子状态</Button>
            </>
          )}
          <Box className="sidebar-tip"><strong>状态 ID</strong><span>{node.id}</span></Box>
          <Button color="error" variant="outlined" startIcon={<DeleteOutline />} onClick={store.deleteSelection}>删除状态</Button>
        </Stack>
      </aside>
    )
  }

  if (!edge) return null
  const assignments = edge.data?.assignments ?? []
  const source = store.nodes.find((item) => item.id === edge.source)
  return (
    <aside className="side-panel inspector">
      <Typography variant="subtitle2">转移属性</Typography>
      <Stack spacing={1.2} sx={{ mt: 1.5 }}>
        <TextField label="事件名称" size="small" value={edge.data?.event ?? ''} onChange={(event) => store.updateEdge(edge.id, { event: event.target.value.toUpperCase() })} />
        <TextField label="守卫条件" size="small" placeholder="例：amount > 5000" value={edge.data?.condition ?? ''} onChange={(event) => store.updateEdge(edge.id, { condition: event.target.value })} />
        <Stack direction="row" spacing={1}>
          <TextField
            type="number"
            size="small"
            label="守卫优先级"
            sx={{ width: 130 }}
            value={edge.data?.priority ?? ''}
            helperText="越大越优先"
            onChange={(event) => store.updateEdge(edge.id, { priority: event.target.value === '' ? undefined : Number(event.target.value) })}
          />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pt: 1 }}>
            同一事件命中多条转移时取优先级最高者；并列最高会在轨迹中标为冲突。{source?.data.kind === 'compound' ? '来自复合状态边框的转移在所有支路结束时触发。' : ''}
          </Typography>
        </Stack>
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
