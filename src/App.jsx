import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { layoutGraph, topicColor } from './layout.js'
import { ModuleNode, UnresolvedNode } from './ModuleNode.jsx'
import { EditPanel } from './EditPanel.jsx'
import { WireModal } from './WireModal.jsx'
import { ConfirmModal } from './ConfirmModal.jsx'
import { PromptModal } from './PromptModal.jsx'
import { deriveGraph, allTopics, toYamlText, blankNode, isValidToken, validateFlow, isValidFlowJson } from './graphModel.js'
import { useHistoryState } from './useHistoryState.js'

const nodeTypes = { module: ModuleNode, unresolved: UnresolvedNode }

// Same ?flow= convention a later runtime-configurable flow.json source
// will use for the fetch itself — reading it here too means the position
// cache is already namespaced per flow before that lands, so two
// different flow.yml files (likely sharing common node names) never
// collide on a single global cache key.
const flowSource = new URLSearchParams(window.location.search).get('flow') ?? '/flow.json'
const POSITIONS_KEY = `zmq-viewer:positions:${flowSource}`

const EDIT_SERVER_STORAGE_KEY = 'zmq-viewer:editServerUrl'
const DEFAULT_EDIT_SERVER_URL = 'http://localhost:4568'

// ?editServer= (explicit, shareable via URL) beats a sticky localStorage
// setting beats the default — matches flow-edit-server.js's own `node
// server/flow-edit-server.js flow.yml [port]` CLI arg, which the client
// previously had no way to discover/target at all.
function resolveEditServerUrl() {
  const fromQuery = new URLSearchParams(window.location.search).get('editServer')
  if (fromQuery) return fromQuery
  try {
    return localStorage.getItem(EDIT_SERVER_STORAGE_KEY) || DEFAULT_EDIT_SERVER_URL
  } catch {
    return DEFAULT_EDIT_SERVER_URL
  }
}

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

function mapGraphToNodes(graph) {
  return graph.nodes.map((n) => ({
    name: n.name,
    cmd: n.cmd,
    publishes: [...n.publishes],
    subscribes: [...n.subscribes],
    env: { ...n.env },
  }))
}

// A small "recently opened" list, keyed by the same ?flow= value used to
// fetch flow.json — lets a user get back to a flow source they had open
// before, the same way an editor remembers recent projects. Only fetched
// sources are recorded (an uploaded file has no URL to reopen).
const RECENT_SOURCES_KEY = 'zmq-viewer:recentFlowSources'
const MAX_RECENT_SOURCES = 5

function loadRecentFlowSources() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_SOURCES_KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function recordRecentFlowSource(source) {
  try {
    const rest = loadRecentFlowSources().filter((s) => s !== source)
    localStorage.setItem(RECENT_SOURCES_KEY, JSON.stringify([source, ...rest].slice(0, MAX_RECENT_SOURCES)))
  } catch {
    // localStorage unavailable — recent list just won't persist.
  }
}

function hrefForSource(source) {
  return source === '/flow.json' ? window.location.pathname : `${window.location.pathname}?flow=${encodeURIComponent(source)}`
}

export default function App() {
  const {
    value: flowNodes,
    set: setFlowNodes,
    replaceWithoutHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistoryState(null)
  const [error, setError] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [selectedName, setSelectedName] = useState(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null)
  const [pendingConnection, setPendingConnection] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [addNodeOpen, setAddNodeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editServerUrl, setEditServerUrl] = useState(resolveEditServerUrl)
  // The last flowNodes reference known to be written to flow.yml (set on
  // load and after a successful save-to-disk — NOT after the clipboard
  // fallback, since that hasn't actually persisted anything). Reference
  // equality works here because useHistoryState never mutates in place.
  const [cleanCheckpoint, setCleanCheckpoint] = useState(null)
  const dirty = flowNodes !== null && flowNodes !== cleanCheckpoint
  const [recentSources] = useState(() => loadRecentFlowSources().filter((s) => s !== flowSource))

  const positionsRef = useRef(loadCachedPositions())
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([])
  const [rfEdges, setRfEdges] = useEdgesState([])

  useEffect(() => {
    fetch(flowSource)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((graph) => {
        if (!isValidFlowJson(graph)) {
          throw new Error(`${flowSource} is not shaped like a flow graph (expected { nodes: [...] })`)
        }
        const nodes = mapGraphToNodes(graph)
        replaceWithoutHistory(nodes)
        setCleanCheckpoint(nodes)
        recordRecentFlowSource(flowSource)
      })
      .catch((err) =>
        setError(
          `Could not load ${flowSource} (${err.message}). Run "npm run sync" to generate it from flow.yml, or load a file below.`,
        ),
      )
    // replaceWithoutHistory is a stable useCallback identity; omitted to
    // keep this a true "run once on mount" effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fallback for a statically-hosted build with no server-side flow.json
  // and no ?flow= override: let the user hand the app a file directly,
  // no rebuild required.
  const loadFromFile = useCallback(
    (file) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const graph = JSON.parse(reader.result)
          if (!isValidFlowJson(graph)) {
            throw new Error('not shaped like a flow graph (expected { nodes: [...] })')
          }
          const nodes = mapGraphToNodes(graph)
          replaceWithoutHistory(nodes)
          setCleanCheckpoint(nodes)
          setError(null)
        } catch (err) {
          setError(`Could not read that file (${err.message}).`)
        }
      }
      reader.onerror = () => setError('Could not read that file.')
      reader.readAsText(file)
    },
    [replaceWithoutHistory],
  )

  // Warn before an unsaved edit is silently discarded by a close/refresh.
  useEffect(() => {
    if (!dirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

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

  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z for undo/redo, skipped while typing in a
  // field (so it doesn't fight native input undo) and only while editing.
  useEffect(() => {
    if (!editMode) return
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editMode, undo, redo])

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
  }, [selectedName, setFlowNodes])

  const deleteNode = useCallback((name) => {
    setConfirmAction({
      message: `Delete node "${name}"? This removes it from the flow entirely.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        setFlowNodes((prev) => prev.filter((n) => n.name !== name))
        delete positionsRef.current[name]
        saveCachedPositions(positionsRef.current)
        setSelectedName(null)
        setConfirmAction(null)
      },
    })
  }, [setFlowNodes])

  const addNode = useCallback(() => setAddNodeOpen(true), [])

  const validateNewNodeName = useCallback(
    (trimmed) => {
      if (flowNodes.some((n) => n.name === trimmed)) return `a node named "${trimmed}" already exists`
      if (!isValidToken(trimmed)) return 'name can only contain letters, numbers, "_", ".", "-"'
      return null
    },
    [flowNodes],
  )

  const confirmAddNode = useCallback((trimmed) => {
    setFlowNodes((prev) => [...prev, blankNode(trimmed)])
    setSelectedName(trimmed)
    setAddNodeOpen(false)
  }, [setFlowNodes])

  const resetLayout = useCallback(() => {
    positionsRef.current = {}
    saveCachedPositions({})
    // Force the reconciliation effect to treat everything as missing again.
    // Not a content edit, so it shouldn't be undoable.
    replaceWithoutHistory((prev) => [...prev])
  }, [replaceWithoutHistory])

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
    [pendingConnection, setFlowNodes],
  )

  const onEdgeClick = useCallback(
    (_event, edge) => {
      if (!editMode || edge.data.unresolved) return
      const { topic } = edge.data
      setConfirmAction({
        message: `Remove "${edge.target}"'s subscription to "${topic}"? This affects every publisher of that topic, since subscriptions are topic-based, not per-wire.`,
        confirmLabel: 'Remove',
        onConfirm: () => {
          setFlowNodes((prev) =>
            prev.map((n) => (n.name === edge.target ? { ...n, subscribes: n.subscribes.filter((t) => t !== topic) } : n)),
          )
          setConfirmAction(null)
        },
      })
    },
    [editMode, setFlowNodes],
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
      const res = await fetch(`${editServerUrl}/api/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: flowNodes }),
        signal: AbortSignal.timeout(2000),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaveStatus('Saved to flow.yml ✓')
      setCleanCheckpoint(flowNodes)
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
  }, [flowNodes, editServerUrl])

  const confirmSettings = useCallback((value) => {
    setEditServerUrl(value)
    try {
      localStorage.setItem(EDIT_SERVER_STORAGE_KEY, value)
    } catch {
      // localStorage unavailable — the value still applies for this
      // session, it just won't be sticky across reloads.
    }
    setSettingsOpen(false)
  }, [])

  if (error) {
    return (
      <div className="status status--error">
        <div className="status__content">
          <p>{error}</p>
          <label className="status__upload">
            Load a flow.json file:
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => e.target.files[0] && loadFromFile(e.target.files[0])}
            />
          </label>
          {recentSources.length > 0 && (
            <div className="status__recent">
              <p>Or open a recent flow:</p>
              <ul>
                {recentSources.map((src) => (
                  <li key={src}>
                    <a href={hrefForSource(src)}>{src}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    )
  }
  if (!flowNodes) return <div className="status">Loading {flowSource}…</div>

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
              <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
                Undo
              </button>
              <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
                Redo
              </button>
              <button onClick={resetLayout}>Auto Layout</button>
              <button className="app__save" onClick={save}>
                Save flow.yml
              </button>
            </>
          )}
          <button className={`app__edit-toggle${editMode ? ' active' : ''}`} onClick={() => setEditMode((v) => !v)}>
            {editMode ? 'Done Editing' : 'Edit'}
          </button>
          <button
            className="app__settings"
            onClick={() => setSettingsOpen(true)}
            title={`Edit server: ${editServerUrl}`}
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>
      {saveStatus && <div className="save-status">{saveStatus}</div>}
      {!saveStatus && dirty && <div className="save-status save-status--dirty">Unsaved changes</div>}
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

        {confirmAction && (
          <ConfirmModal
            message={confirmAction.message}
            confirmLabel={confirmAction.confirmLabel}
            onConfirm={confirmAction.onConfirm}
            onCancel={() => setConfirmAction(null)}
          />
        )}

        {addNodeOpen && (
          <PromptModal
            title="Add Node"
            label="New node name (lower_snake_case, matches its NODE_NAME):"
            placeholder="node_name"
            confirmLabel="Add"
            validate={validateNewNodeName}
            onConfirm={confirmAddNode}
            onCancel={() => setAddNodeOpen(false)}
          />
        )}

        {settingsOpen && (
          <PromptModal
            title="Settings"
            label="Edit server URL — where 'Save flow.yml' POSTs to (matches the port server/flow-edit-server.js is running on):"
            placeholder={DEFAULT_EDIT_SERVER_URL}
            initialValue={editServerUrl}
            confirmLabel="Save"
            validate={(value) => {
              try {
                new URL(value)
                return null
              } catch {
                return 'must be a full URL, e.g. http://localhost:4568'
              }
            }}
            onConfirm={confirmSettings}
            onCancel={() => setSettingsOpen(false)}
          >
            {recentSources.length > 0 && (
              <div className="modal__recent">
                <p className="modal__hint">Switch to a recent flow:</p>
                <ul>
                  {recentSources.map((src) => (
                    <li key={src}>
                      <a href={hrefForSource(src)}>{src}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </PromptModal>
        )}
      </div>
    </div>
  )
}
