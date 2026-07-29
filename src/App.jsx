import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { layoutGraph, topicColor } from './layout.js'
import { ModuleNode, UnresolvedNode } from './ModuleNode.jsx'
import { EditPanel } from './EditPanel.jsx'
import { WireModal } from './WireModal.jsx'
import { deriveGraph, allTopics, toYamlText, blankNode, isValidToken, validateFlow, isValidFlowJson } from './graphModel.js'

const nodeTypes = { module: ModuleNode, unresolved: UnresolvedNode }

const POSITIONS_KEY = 'zmq-viewer:positions'
const EDIT_SERVER_URL = 'http://localhost:4568'

function loadCachedPositions() {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY)) ?? {}
  } catch {
    return {}
  }
}

function saveCachedPositions(positions) {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions))
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — layout
    // just won't persist across reloads. Not worth surfacing to the user.
  }
}

export default function App() {
  const [flowNodes, setFlowNodes] = useState(null)
  const [error, setError] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [selectedName, setSelectedName] = useState(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null)
  const [pendingConnection, setPendingConnection] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null)

  const positionsRef = useRef(loadCachedPositions())
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([])
  const [rfEdges, setRfEdges] = useEdgesState([])

  useEffect(() => {
    fetch('/flow.json')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((graph) => {
        if (!isValidFlowJson(graph)) {
          throw new Error('flow.json is not shaped like a flow graph (expected { nodes: [...] })')
        }
        setFlowNodes(
          graph.nodes.map((n) => ({
            name: n.name,
            cmd: n.cmd,
            publishes: [...n.publishes],
            subscribes: [...n.subscribes],
            env: { ...n.env },
          })),
        )
      })
      .catch((err) =>
        setError(
          `Could not load flow.json (${err.message}). Run "npm run sync" to generate it from flow.yml.`,
        ),
      )
  }, [])

  const liveGraph = useMemo(() => (flowNodes ? deriveGraph(flowNodes) : null), [flowNodes])
  const topics = useMemo(() => (flowNodes ? allTopics(flowNodes) : []), [flowNodes])

  // Reconcile React Flow's visual nodes/edges whenever the logical graph
  // changes. Positions are preserved for anything already laid out;
  // brand-new ids (a fresh load, a node just added, a topic that just
  // became unresolved) get placed via dagre (first load) or a simple
  // offset heuristic (everything after), and cached so edits never reset
  // a layout the user has already arranged.
  useEffect(() => {
    if (!liveGraph) return

    const wantedIds = new Set([
      ...liveGraph.nodes.map((n) => n.name),
      ...liveGraph.unresolved.map((u) => `unresolved:${u.topic}`),
    ])
    const cache = positionsRef.current
    const missing = [...wantedIds].filter((id) => !cache[id])

    if (missing.length > 0) {
      if (Object.keys(cache).length === 0) {
        // First-ever load (or a fully cleared cache): lay everything out
        // with dagre, same as the original read-only viewer did.
        const { nodes: laidOut } = layoutGraph(liveGraph)
        for (const n of laidOut) cache[n.id] = n.position
      } else {
        // Incremental: place new ids near the current center of mass so
        // they don't spawn on top of an existing node.
        const known = Object.values(cache)
        const cx = known.reduce((s, p) => s + p.x, 0) / known.length || 0
        const cy = known.reduce((s, p) => s + p.y, 0) / known.length || 0
        missing.forEach((id, i) => {
          cache[id] = { x: cx + 260, y: cy + i * 110 }
        })
      }
      saveCachedPositions(cache)
    }

    const moduleNodes = liveGraph.nodes.map((n) => ({
      id: n.name,
      type: 'module',
      data: n,
      position: cache[n.name],
      width: 220,
      height: 90,
    }))
    const unresolvedNodes = liveGraph.unresolved.map((u) => ({
      id: `unresolved:${u.topic}`,
      type: 'unresolved',
      data: { topic: u.topic },
      position: cache[`unresolved:${u.topic}`],
      width: 160,
      height: 66,
    }))

    setRfNodes([...moduleNodes, ...unresolvedNodes])
    setRfEdges([
      ...liveGraph.edges.map((e) => ({
        id: `${e.from}->${e.to}:${e.topic}`,
        source: e.from,
        target: e.to,
        data: { topic: e.topic },
        style: { stroke: topicColor(e.topic), strokeWidth: 2 },
      })),
      ...liveGraph.unresolved.map((u) => ({
        id: `unresolved:${u.topic}->${u.to}`,
        source: `unresolved:${u.topic}`,
        target: u.to,
        data: { topic: u.topic, unresolved: true },
        style: { stroke: 'var(--warn)', strokeWidth: 2, strokeDasharray: '4 3' },
      })),
    ])
    // setRfNodes/setRfEdges are stable setters from useNodesState/useEdgesState
    // (identity never changes), so they're deliberately left out here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveGraph])

  // Persist dragged positions.
  const handleRfNodesChange = useCallback(
    (changes) => {
      onRfNodesChange(changes)
      let touched = false
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          positionsRef.current[c.id] = c.position
          touched = true
        }
      }
      if (touched) saveCachedPositions(positionsRef.current)
    },
    [onRfNodesChange],
  )

  const displayEdges = useMemo(
    () => rfEdges.map((e) => (e.id === hoveredEdgeId ? { ...e, label: e.data.topic } : e)),
    [rfEdges, hoveredEdgeId],
  )

  const legend = useMemo(() => {
    if (!liveGraph) return []
    const seen = [...new Set(liveGraph.edges.map((e) => e.topic))].sort()
    return seen.map((topic) => ({ topic, color: topicColor(topic) }))
  }, [liveGraph])

  const selected = flowNodes?.find((n) => n.name === selectedName) ?? null

  const onNodeClick = useCallback((_event, node) => {
    setSelectedName(node.type === 'module' ? node.id : null)
  }, [])

  const updateNode = useCallback((updated) => {
    setFlowNodes((prev) => prev.map((n) => (n.name === selectedName ? updated : n)))
    setSelectedName(updated.name)
  }, [selectedName])

  const deleteNode = useCallback((name) => {
    if (!confirm(`Delete node "${name}"? This removes it from the flow entirely.`)) return
    setFlowNodes((prev) => prev.filter((n) => n.name !== name))
    delete positionsRef.current[name]
    saveCachedPositions(positionsRef.current)
    setSelectedName(null)
  }, [])

  const addNode = useCallback(() => {
    const name = prompt('New node name (lower_snake_case, matches its NODE_NAME):')
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return
    if (flowNodes.some((n) => n.name === trimmed)) {
      alert(`A node named "${trimmed}" already exists.`)
      return
    }
    if (!isValidToken(trimmed)) {
      alert('Node names can only contain letters, numbers, "_", ".", "-".')
      return
    }
    setFlowNodes((prev) => [...prev, blankNode(trimmed)])
    setSelectedName(trimmed)
  }, [flowNodes])

  const resetLayout = useCallback(() => {
    positionsRef.current = {}
    saveCachedPositions({})
    // Force the reconciliation effect to treat everything as missing again.
    setFlowNodes((prev) => [...prev])
  }, [])

  const onConnect = useCallback(
    (connection) => {
      if (connection.source.startsWith('unresolved:') || connection.target.startsWith('unresolved:')) return
      setPendingConnection({ source: connection.source, target: connection.target })
    },
    [],
  )

  const confirmWire = useCallback(
    (topic) => {
      if (!pendingConnection) return
      const { source, target } = pendingConnection
      setFlowNodes((prev) =>
        prev.map((n) => {
          if (n.name === source && !n.publishes.includes(topic)) return { ...n, publishes: [...n.publishes, topic] }
          if (n.name === target && !n.subscribes.includes(topic)) return { ...n, subscribes: [...n.subscribes, topic] }
          return n
        }),
      )
      setPendingConnection(null)
    },
    [pendingConnection],
  )

  const onEdgeClick = useCallback(
    (_event, edge) => {
      if (!editMode || edge.data.unresolved) return
      const { topic } = edge.data
      if (!confirm(`Remove "${edge.target}"'s subscription to "${topic}"?\n(This affects every publisher of that topic, since subscriptions are topic-based, not per-wire.)`)) return
      setFlowNodes((prev) =>
        prev.map((n) => (n.name === edge.target ? { ...n, subscribes: n.subscribes.filter((t) => t !== topic) } : n)),
      )
    },
    [editMode],
  )

  const save = useCallback(async () => {
    const issues = validateFlow(flowNodes)
    if (issues.length > 0) {
      setSaveStatus(`Can't save — ${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ''}`)
      setTimeout(() => setSaveStatus(null), 8000)
      return
    }
    setSaveStatus('Saving…')
    try {
      const res = await fetch(`${EDIT_SERVER_URL}/api/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: flowNodes }),
        signal: AbortSignal.timeout(2000),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaveStatus('Saved to flow.yml ✓')
    } catch {
      try {
        await navigator.clipboard.writeText(toYamlText(flowNodes))
        setSaveStatus('No edit server running — copied flow.yml text to your clipboard instead.')
      } catch {
        setSaveStatus('No edit server running, and clipboard access failed. See the console for the YAML.')
        console.log(toYamlText(flowNodes))
      }
    }
    setTimeout(() => setSaveStatus(null), 5000)
  }, [flowNodes])

  if (error) return <div className="status status--error">{error}</div>
  if (!flowNodes) return <div className="status">Loading flow.yml…</div>

  return (
    <div className="app">
      <header className="app__header">
        <h1>flow.yml wiring</h1>
        <span className="app__subtitle">
          {liveGraph.nodes.length} nodes · {liveGraph.edges.length} wires
          {liveGraph.unresolved.length > 0 && ` · ${liveGraph.unresolved.length} unresolved`}
        </span>
        <div className="app__toolbar">
          {editMode && (
            <>
              <button onClick={addNode}>+ Add Node</button>
              <button onClick={resetLayout}>Auto Layout</button>
              <button className="app__save" onClick={save}>
                Save flow.yml
              </button>
            </>
          )}
          <button className={`app__edit-toggle${editMode ? ' active' : ''}`} onClick={() => setEditMode((v) => !v)}>
            {editMode ? 'Done Editing' : 'Edit'}
          </button>
        </div>
      </header>
      {saveStatus && <div className="save-status">{saveStatus}</div>}
      <div className="app__body">
        <ReactFlow
          nodes={rfNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleRfNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedName(null)}
          onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          onEdgeClick={onEdgeClick}
          onConnect={onConnect}
          nodesDraggable={editMode}
          nodesConnectable={editMode}
          edgesReconnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.25 }}
          defaultEdgeOptions={{
            labelBgPadding: [6, 3],
            labelBgBorderRadius: 4,
            labelStyle: { fontSize: 11, fontWeight: 600 },
            labelBgStyle: { fillOpacity: 0.95 },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>

        {legend.length > 0 && (
          <div className="legend">
            {legend.map(({ topic, color }) => (
              <div className="legend__item" key={topic}>
                <span className="legend__swatch" style={{ background: color }} />
                {topic}
              </div>
            ))}
            {liveGraph.unresolved.length > 0 && (
              <div className="legend__item">
                <span className="legend__swatch legend__swatch--unresolved" />
                unresolved
              </div>
            )}
          </div>
        )}

        {selected && editMode && (
          <EditPanel
            key={selected.name}
            node={selected}
            siblingNames={flowNodes.filter((n) => n.name !== selected.name).map((n) => n.name)}
            allTopics={topics}
            onChange={updateNode}
            onDelete={deleteNode}
            onClose={() => setSelectedName(null)}
          />
        )}

        {selected && !editMode && (
          <aside className="details">
            <button className="details__close" onClick={() => setSelectedName(null)}>
              ×
            </button>
            <h2>{selected.name}</h2>
            <code className="details__cmd">{selected.cmd}</code>

            <h3>Publishes</h3>
            {selected.publishes.length > 0 ? (
              <ul>
                {selected.publishes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className="details__empty">nothing</p>
            )}

            <h3>Subscribes</h3>
            {selected.subscribes.length > 0 ? (
              <ul>
                {selected.subscribes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className="details__empty">nothing</p>
            )}

            {Object.keys(selected.env).length > 0 && (
              <>
                <h3>Env</h3>
                <ul>
                  {Object.entries(selected.env).map(([k, v]) => (
                    <li key={k}>
                      {k}={v}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}

        {pendingConnection && (
          <WireModal
            sourceName={pendingConnection.source}
            targetName={pendingConnection.target}
            sourcePublishes={flowNodes.find((n) => n.name === pendingConnection.source)?.publishes ?? []}
            onConfirm={confirmWire}
            onCancel={() => setPendingConnection(null)}
          />
        )}
      </div>
    </div>
  )
}
