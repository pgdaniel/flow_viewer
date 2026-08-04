import dagre from 'dagre'

const NODE_WIDTH = 220
const NODE_HEIGHT = 90
const UNRESOLVED_WIDTH = 160
const UNRESOLVED_HEIGHT = 66

// Stable hue per topic name, so the same topic always wires up the same
// color across a session (and the legend swatch matches the wire).
export function topicColor(topic) {
  let hash = 0
  for (let i = 0; i < topic.length; i++) {
    hash = (hash * 31 + topic.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 45%)`
}

// Positions module nodes left-to-right by pub/sub dependency and drops an
// unresolved-topic ghost node in front of whatever subscribes to it.
// flow.yml carries no coordinates, so layout is recomputed every load.
//
// Edges deliberately have no permanent text label: two topics between the
// same pair of nodes (e.g. ecu <-> telemetry) share the same bezier
// midpoint regardless of curve bow, since both handles are horizontal —
// so labels always overlap. Wires are colored by topic instead, with the
// topic name shown on hover (see App.jsx) and in the details panel.
export function layoutGraph(graph) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 })
  g.setDefaultEdgeLabel(() => ({}))

  // Width/height are set explicitly (rather than left for React Flow to
  // measure from the DOM) because the initial dagre layout runs before
  // any DOM exists, and the MiniMap needs an explicit size to draw
  // anything. Edit mode does wire up onNodesChange for drag persistence,
  // but the first layout and any "Auto Layout" reset still need these.
  const nodes = graph.nodes.map((node) => ({
    id: node.name,
    type: 'module',
    data: { ...node },
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }))

  graph.unresolved.forEach((u) => {
    nodes.push({
      id: `unresolved:${u.topic}`,
      type: 'unresolved',
      data: { topic: u.topic },
      position: { x: 0, y: 0 },
      width: UNRESOLVED_WIDTH,
      height: UNRESOLVED_HEIGHT,
    })
  })

  const edges = [
    ...graph.edges.map((e) => ({
      id: `${e.from}->${e.to}:${e.topic}`,
      source: e.from,
      target: e.to,
      data: { topic: e.topic },
      style: { stroke: topicColor(e.topic), strokeWidth: 2 },
    })),
    ...graph.unresolved.map((u) => ({
      id: `unresolved:${u.topic}->${u.to}`,
      source: `unresolved:${u.topic}`,
      target: u.to,
      data: { topic: u.topic, unresolved: true },
      style: { stroke: 'var(--warn)', strokeWidth: 2, strokeDasharray: '4 3' },
    })),
  ]

  nodes.forEach((n) => g.setNode(n.id, { width: n.width, height: n.height }))
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)

  const positioned = nodes.map((n) => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - n.width / 2, y: y - n.height / 2 } }
  })

  return { nodes: positioned, edges }
}
