// Pure, dependency-free client-side mirror of the topology/serialization
// logic in node_zmq_framework's lib/flow.js. Duplicated on purpose rather
// than imported: the viewer's core editing feature (derive a graph from
// an edited node list, produce a flow.yml you can copy out) must work
// with zero new dependencies and zero running server — see the optional
// server/flow-edit-server.js for the one piece that *does* reuse
// node_zmq_framework directly (actual disk I/O), which is intentionally
// kept separate and opt-in.
//
// If you touch the wiring/graph/YAML rules here, mirror the change in
// node_zmq_framework/lib/flow.js too (and vice versa) — they're meant to
// stay byte-for-byte equivalent on the graph() and toYamlText() shapes.

/// Every node broadcasts :heartbeat implicitly, so for that topic
/// everyone counts as a publisher. A node never peers with itself.
function publisherNames(nodes, topic, exclude) {
  if (topic === 'heartbeat') {
    return nodes.filter((n) => n.name !== exclude).map((n) => n.name)
  }
  return nodes.filter((n) => n.name !== exclude && n.publishes.includes(topic)).map((n) => n.name)
}

/// The node-to-node topology: every topic a node subscribes to becomes an
/// edge from each of its publishers, except heartbeat (implicit,
/// all-to-all, drawn separately) and topics nobody publishes (surfaced as
/// unresolved instead of a dangling edge). Same shape as flow.json /
/// node_zmq_framework's Flow#graph().
export function deriveGraph(nodes) {
  const edges = []
  const unresolved = []

  for (const node of nodes) {
    for (const topic of node.subscribes) {
      if (topic === 'heartbeat') continue
      const publishers = publisherNames(nodes, topic, node.name)
      if (publishers.length === 0) {
        unresolved.push({ topic, to: node.name })
      } else {
        for (const from of publishers) edges.push({ from, to: node.name, topic })
      }
    }
  }

  return { nodes, edges, unresolved }
}

/// Every topic touched anywhere in the graph, for the wire-picker's
/// autocomplete and the subscribe/publish chip inputs' suggestions.
export function allTopics(nodes) {
  const topics = new Set()
  for (const node of nodes) {
    for (const t of node.publishes) topics.add(t)
    for (const t of node.subscribes) topics.add(t)
  }
  return [...topics].sort()
}

/// Keeps bare tokens bare (matches flow.yml's existing style, e.g.
/// `CAN_IFACE: vcan0`), quotes anything with spaces/colons/commas so it
/// round-trips through the parsers' flow-map splitter unambiguously, and
/// quotes anything that *looks* numeric (e.g. "4567") even though none of
/// the five hand-rolled parsers do YAML-style type inference — a value
/// like WEB_PORT is meant to be a string, and an unquoted number is
/// exactly the kind of thing a real YAML library (if one ever replaces
/// one of these parsers) would silently reinterpret as an integer.
function quoteIfNeeded(value) {
  if (value === '') return '""'
  if (/^-?\d+(\.\d+)?$/.test(value)) return JSON.stringify(value)
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value
  return JSON.stringify(value)
}

/// Serializes to the same minimal YAML subset every port's parser
/// understands: a top-level `nodes:` map, 2-space-indented blocks,
/// flow-style lists/maps. See node_zmq_framework/lib/flow.js#toYamlText
/// for the canonical, tested version this mirrors.
export function toYamlText(nodes) {
  const lines = ['nodes:']
  for (const node of nodes) {
    lines.push(`  ${node.name}:`)
    lines.push(`    cmd: ${node.cmd}`)
    if (node.publishes.length) lines.push(`    publishes: [${node.publishes.join(', ')}]`)
    if (node.subscribes.length) lines.push(`    subscribes: [${node.subscribes.join(', ')}]`)
    const envEntries = Object.entries(node.env)
    if (envEntries.length) {
      const pairs = envEntries.map(([k, v]) => `${k}: ${quoteIfNeeded(v)}`).join(', ')
      lines.push(`    env: { ${pairs} }`)
    }
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

/// A fresh, empty node for the "Add Node" toolbar action.
export function blankNode(name) {
  return { name, cmd: '', publishes: [], subscribes: [], env: {} }
}
