// graphModel.js is a deliberate hand-maintained mirror of
// node_zmq_framework/lib/flow.js's graph()/toYamlText() logic (see the
// comment at the top of graphModel.js). graphModel.test.js exercises the
// mirror on its own, but nothing catches the two copies *drifting* apart
// if only one side gets edited. This file is that drift detector: when a
// clone of node_zmq_framework happens to be sitting next to this repo (as
// it is on the maintainer's machine), it feeds identical input through
// both implementations and asserts identical output. Skips cleanly (not a
// failure) when the sibling isn't present, matching the same
// guarded-optional-import pattern scripts/sync.mjs and
// server/flow-edit-server.js already use.
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deriveGraph, toYamlText } from './graphModel.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const flowModulePath = path.join(here, '../../node_zmq_framework/lib/flow.js')

let Flow = null
try {
  ;({ Flow } = await import(pathToFileURL(flowModulePath).href))
} catch {
  // No sibling clone at this path — the tests below skip themselves.
}

const describeIfSibling = Flow ? describe : describe.skip

const NODES = [
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
    env: { VERBOSE: '1', WEB_PORT: '4567', MSG: 'has, comma and: colon' },
  },
]

describeIfSibling('graphModel.js vs node_zmq_framework/lib/flow.js', () => {
  it('deriveGraph matches Flow#graph edge-for-edge', () => {
    const mirror = deriveGraph(NODES)
    const original = new Flow(NODES).graph()
    expect(mirror.edges).toEqual(original.edges)
    expect(mirror.unresolved).toEqual(original.unresolved)
  })

  it('toYamlText produces byte-identical output to Flow#toYamlText', () => {
    const mirrorText = toYamlText(NODES)
    const originalText = new Flow(NODES).toYamlText()
    expect(mirrorText).toBe(originalText)
  })
})
