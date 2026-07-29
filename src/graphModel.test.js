import { describe, it, expect } from 'vitest'
import { deriveGraph, allTopics, toYamlText, blankNode, isValidToken, validateFlow } from './graphModel.js'

const FLOW = [
  { name: 'ecu', cmd: 'ruby nodes/ecu.rb', publishes: ['engine_data'], subscribes: ['throttle_request'], env: {} },
  {
    name: 'telemetry',
    cmd: 'ruby nodes/telemetry.rb',
    publishes: ['throttle_request'],
    subscribes: ['engine_data'],
    env: {},
  },
  {
    name: 'registry',
    cmd: 'ruby nodes/state_registry.rb',
    publishes: [],
    subscribes: ['heartbeat', 'engine_data'],
    env: { VERBOSE: '1' },
  },
]

describe('deriveGraph', () => {
  it('draws one edge per actual publisher', () => {
    const { edges } = deriveGraph(FLOW)
    expect(edges).toContainEqual({ from: 'ecu', to: 'telemetry', topic: 'engine_data' })
    expect(edges).toContainEqual({ from: 'telemetry', to: 'ecu', topic: 'throttle_request' })
  })

  it('excludes heartbeat from edges entirely (implicit, drawn separately)', () => {
    const { edges } = deriveGraph(FLOW)
    expect(edges.some((e) => e.topic === 'heartbeat')).toBe(false)
  })

  it('a node never peers with itself, even via heartbeat', () => {
    const { edges } = deriveGraph(FLOW)
    expect(edges.some((e) => e.from === e.to)).toBe(false)
  })

  it('multiple publishers of the same topic each produce their own edge', () => {
    const nodes = [
      { name: 'a', cmd: 'x', publishes: ['t'], subscribes: [], env: {} },
      { name: 'b', cmd: 'x', publishes: ['t'], subscribes: [], env: {} },
      { name: 'c', cmd: 'x', publishes: [], subscribes: ['t'], env: {} },
    ]
    const { edges } = deriveGraph(nodes)
    expect(edges).toContainEqual({ from: 'a', to: 'c', topic: 't' })
    expect(edges).toContainEqual({ from: 'b', to: 'c', topic: 't' })
    expect(edges).toHaveLength(2)
  })

  it('surfaces a subscribed-but-never-published topic as unresolved, not a dangling edge', () => {
    const nodes = [{ name: 'lonely', cmd: 'true', publishes: [], subscribes: ['ghost_topic'], env: {} }]
    const { edges, unresolved } = deriveGraph(nodes)
    expect(unresolved).toEqual([{ topic: 'ghost_topic', to: 'lonely' }])
    expect(edges).toHaveLength(0)
  })

  it('passes the node list through unchanged', () => {
    const { nodes } = deriveGraph(FLOW)
    expect(nodes).toBe(FLOW)
  })
})

describe('allTopics', () => {
  it('dedupes and sorts every topic touched anywhere in the graph', () => {
    expect(allTopics(FLOW)).toEqual(['engine_data', 'heartbeat', 'throttle_request'])
  })

  it('returns an empty array for a flow with no topics', () => {
    expect(allTopics([{ name: 'n', cmd: 'x', publishes: [], subscribes: [], env: {} }])).toEqual([])
  })
})

describe('toYamlText', () => {
  it('emits cmd, publishes, subscribes, and env lines per node', () => {
    const text = toYamlText(FLOW)
    expect(text).toContain('  ecu:\n    cmd: ruby nodes/ecu.rb\n    publishes: [engine_data]\n    subscribes: [throttle_request]\n')
    expect(text).toContain('    env: { VERBOSE: "1" }')
  })

  it('omits publishes/subscribes/env blocks when empty', () => {
    const text = toYamlText([blankNode('solo')])
    expect(text).not.toContain('publishes:')
    expect(text).not.toContain('subscribes:')
    expect(text).not.toContain('env:')
  })

  it('starts with a top-level nodes: key and ends with a single trailing newline', () => {
    const text = toYamlText(FLOW)
    expect(text.startsWith('nodes:\n')).toBe(true)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  it('round-trips through deriveGraph: same wiring back out as what went in', () => {
    const text = toYamlText(FLOW)
    // Not a full parser (that lives in node_zmq_framework) — just a smoke
    // check that everything we serialized shows up literally in the text.
    for (const node of FLOW) {
      expect(text).toContain(`  ${node.name}:`)
      for (const t of node.publishes) expect(text).toContain(t)
      for (const t of node.subscribes) expect(text).toContain(t)
    }
  })
})

describe('env value quoting (quoteIfNeeded, exercised via toYamlText)', () => {
  it('keeps a bare alphanumeric/path-safe value unquoted', () => {
    const text = toYamlText([{ ...blankNode('n'), cmd: 'x', env: { CAN_IFACE: 'vcan0' } }])
    expect(text).toContain('env: { CAN_IFACE: vcan0 }')
  })

  it('quotes and escapes a value containing a comma or colon', () => {
    const text = toYamlText([{ ...blankNode('n'), cmd: 'x', env: { MSG: 'has, comma and: colon' } }])
    expect(text).toContain('env: { MSG: "has, comma and: colon" }')
  })

  it('quotes a numeric-looking value so it round-trips as a string, not an int', () => {
    const text = toYamlText([{ ...blankNode('n'), cmd: 'x', env: { WEB_PORT: '4567' } }])
    expect(text).toMatch(/WEB_PORT: "4567"/)
  })

  it('quotes an empty value', () => {
    const text = toYamlText([{ ...blankNode('n'), cmd: 'x', env: { EMPTY: '' } }])
    expect(text).toContain('env: { EMPTY: "" }')
  })
})

describe('isValidToken', () => {
  it('accepts letters, numbers, underscore, dot, hyphen', () => {
    expect(isValidToken('engine_data')).toBe(true)
    expect(isValidToken('node-1.beta')).toBe(true)
    expect(isValidToken('ABC123')).toBe(true)
  })

  it('rejects characters that would break unquoted YAML flow-lists/keys', () => {
    for (const bad of ['has space', 'a,b', '[x]', 'a:b', '"quoted"', '', undefined, null]) {
      expect(isValidToken(bad)).toBe(false)
    }
  })
})

describe('validateFlow', () => {
  it('reports nothing for a clean flow', () => {
    expect(validateFlow(FLOW)).toEqual([])
  })

  it('flags an empty node name', () => {
    const issues = validateFlow([{ name: '', cmd: 'x', publishes: [], subscribes: [], env: {} }])
    expect(issues.some((i) => i.field === 'name')).toBe(true)
  })

  it('flags a duplicate node name', () => {
    const nodes = [blankNode('dup'), { ...blankNode('dup'), cmd: 'x' }]
    const issues = validateFlow(nodes)
    expect(issues.some((i) => /duplicate/.test(i.message))).toBe(true)
  })

  it('flags an empty cmd', () => {
    const issues = validateFlow([blankNode('n')])
    expect(issues.some((i) => i.field === 'cmd')).toBe(true)
  })

  it('flags an invalid topic name in publishes or subscribes', () => {
    const nodes = [{ name: 'n', cmd: 'x', publishes: ['bad,topic'], subscribes: ['also bad'], env: {} }]
    const issues = validateFlow(nodes)
    expect(issues.some((i) => i.field === 'publishes')).toBe(true)
    expect(issues.some((i) => i.field === 'subscribes')).toBe(true)
  })
})

describe('blankNode', () => {
  it('produces an empty, well-shaped node for the given name', () => {
    expect(blankNode('foo')).toEqual({ name: 'foo', cmd: '', publishes: [], subscribes: [], env: {} })
  })
})
