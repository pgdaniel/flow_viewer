import { Handle, Position } from '@xyflow/react'

// One flow.yml node, drawn Node-RED style: a title bar, its shell command,
// and the topics it touches. Ports are generic in/out — flow.yml has no
// notion of separate named ports, only whole-node publish/subscribe lists.
export function ModuleNode({ data, selected }) {
  const isWeb = Boolean(data.env && Object.keys(data.env).length > 0)
  const livenessClass = data.liveness === 'live' ? ' module-node--live' : data.liveness === 'stale' ? ' module-node--stale' : ''

  return (
    <div className={`module-node${selected ? ' selected' : ''}${livenessClass}`}>
      <Handle type="target" position={Position.Left} />
      <div className="module-node__title">
        {data.name}
        {isWeb && <span className="module-node__badge" title="has env overrides">env</span>}
        {data.liveness === 'live' && <span className="module-node__live-dot" title="heartbeat received">&nbsp;</span>}
      </div>
      <div className="module-node__cmd">{data.cmd}</div>
      <div className="module-node__topics">
        <span className="module-node__pill module-node__pill--heartbeat">♥ heartbeat</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function UnresolvedNode({ data }) {
  return (
    <div className="unresolved-node" title="No node in flow.yml publishes this topic">
      <div className="unresolved-node__title">⚠ {data.topic}</div>
      <div className="unresolved-node__subtitle">no publisher</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
