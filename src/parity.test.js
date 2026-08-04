import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deriveGraph, toYamlText } from './graphModel.js'

// Cross-language parity test: verifies that each sibling port's flowctl
// --graph produces identical JSON to this viewer's deriveGraph for the
// same flow.yml. Skips cleanly when a port's binary/toolchain is missing.

const REPOS_ROOT = process.env.FLOW_REPOS_ROOT ?? path.resolve(import.meta.dirname, '../..')

const PORTS = [
  {
    name: 'go',
    cmd: (file) => [path.join(REPOS_ROOT, 'go_zmq_framework/bin/flowctl'), '--graph', file],
  },
  {
    name: 'node',
    cmd: (file) => ['node', path.join(REPOS_ROOT, 'node_zmq_framework/bin/flowctl.js'), '--graph', file],
  },
  {
    name: 'ruby',
    cmd: (file) => ['bundle', 'exec', 'bin/flowctl', '--graph', file],
    cwd: path.join(REPOS_ROOT, 'ruby_zmq_framework'),
  },
  {
    name: 'zig',
    cmd: (file) => [path.join(REPOS_ROOT, 'zig_zmq_framework/zig-out/bin/flowctl'), '--graph', file],
  },
  {
    name: 'rust',
    cmd: (file) => [path.join(REPOS_ROOT, 'rust_zmq_framework/target/debug/flowctl'), '--graph', file],
  },
  {
    name: 'cpp',
    cmd: (file) => [path.join(REPOS_ROOT, 'cpp_zmq_framework/build/flowctl'), '--graph', file],
  },
]

const FIXTURES = [
  {
    name: 'single node',
    nodes: [{ name: 'ecu', cmd: 'bin/ecu', publishes: ['engine_data'], subscribes: [], env: {} }],
  },
  {
    name: 'two nodes with wire',
    nodes: [
      { name: 'ecu', cmd: 'bin/ecu', publishes: ['engine_data'], subscribes: ['throttle_cmd'], env: {} },
      { name: 'telemetry', cmd: 'bin/telemetry', publishes: ['throttle_cmd'], subscribes: ['engine_data'], env: {} },
    ],
  },
  {
    name: 'with env overrides',
    nodes: [
      { name: 'webapp', cmd: 'bin/webapp', publishes: ['cmd'], subscribes: ['data'], env: { WEB_PORT: '4567' } },
      { name: 'sensor', cmd: 'bin/sensor', publishes: ['data'], subscribes: [], env: {} },
    ],
  },
  {
    name: 'unresolved topic',
    nodes: [{ name: 'logger', cmd: 'bin/logger', publishes: [], subscribes: ['missing_topic'], env: {} }],
  },
]

function normalize(graph) {
  // Sort nodes/edges/unresolved for stable comparison
  return {
    nodes: (graph.nodes || []).map((n) => ({
      name: n.name,
      cmd: n.cmd,
      publishes: [...(n.publishes || [])].sort(),
      subscribes: [...(n.subscribes || [])].sort(),
      env: n.env || {},
    })).sort((a, b) => a.name.localeCompare(b.name)),
    edges: (graph.edges || []).map((e) => ({
      from: e.from,
      to: e.to,
      topic: e.topic,
    })).sort((a, b) => `${a.from}-${a.to}-${a.topic}`.localeCompare(`${b.from}-${b.to}-${b.topic}`)),
    unresolved: (graph.unresolved || []).map((u) => ({
      topic: u.topic,
      to: u.to,
    })).sort((a, b) => `${a.topic}-${a.to}`.localeCompare(`${b.topic}-${b.to}`)),
  }
}

function runFlowctl(port, file) {
  const [cmd, ...args] = port.cmd(file)
  const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  if (port.cwd) opts.cwd = port.cwd
  const stdout = execFileSync(cmd, args, opts)
  // flowctl may print warnings to stderr; we only care about stdout JSON
  return JSON.parse(stdout)
}

describe('cross-language parity', () => {
  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      const expected = normalize(deriveGraph(fixture.nodes))

      for (const port of PORTS) {
        it(`${port.name} matches deriveGraph`, () => {
          let tmpDir
          let tmpFile
          try {
            tmpDir = mkdtempSync(path.join(tmpdir(), 'flow-parity-'))
            tmpFile = path.join(tmpDir, 'flow.yml')
            writeFileSync(tmpFile, toYamlText(fixture.nodes))
            const actual = normalize(runFlowctl(port, tmpFile))
            expect(actual).toEqual(expected)
          } catch (err) {
            if (err.code === 'ENOENT' || err.status === 127 || err.message.includes('ENOENT')) {
              // Binary not found, skip
              return
            }
            throw err
          } finally {
            if (tmpFile) {
              try { unlinkSync(tmpFile) } catch {}
            }
            if (tmpDir) {
              try {
                const { rmdirSync } = require('node:fs')
                rmdirSync(tmpDir)
              } catch {}
            }
          }
        })
      }
    })
  }
})
