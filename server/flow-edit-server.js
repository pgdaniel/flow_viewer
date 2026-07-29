#!/usr/bin/env node
// Optional local write-back API for the viewer's editing feature. NOT
// part of the Vite app or its package.json — the viewer works fully
// (view, edit, "Copy YAML") without this ever running. Run it only if
// you want the "Save flow.yml" button to write straight to disk instead
// of falling back to a clipboard copy:
//
//   node server/flow-edit-server.js /path/to/some/flow.yml [port]
//
// Works against a flow.yml from *any* of the five ports (Ruby, Zig, Go,
// Rust, Node) — the graph shape is identical regardless of which one
// wrote it. Needs node_zmq_framework cloned as a sibling of this repo,
// though — it's the one port whose Flow module can serialize a node list
// back to YAML (see its lib/flow.js#toYamlText). That's a deliberate,
// narrow reason to depend on it here: this script only ever touches the
// filesystem and never runs as part of `npm install`/`npm run dev`/
// `npm run build`.
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
// FLOW_MODULE_PATH overrides the default sibling-clone assumption, for
// anyone whose node_zmq_framework checkout doesn't live at ../node_zmq_framework.
const flowModulePath = process.env.FLOW_MODULE_PATH ?? path.join(here, '../../node_zmq_framework/lib/flow.js')

let Flow
try {
  ;({ Flow } = await import(pathToFileURL(path.resolve(flowModulePath)).href))
} catch (err) {
  console.error(`[flow-edit-server] Couldn't load node_zmq_framework's Flow module from ${flowModulePath}`)
  console.error('[flow-edit-server] Clone it as a sibling of this repo to use this server:')
  console.error('[flow-edit-server]   git clone https://github.com/pgdaniel/node_zmq_framework ../node_zmq_framework')
  console.error('[flow-edit-server] ...or point FLOW_MODULE_PATH at wherever your checkout lives:')
  console.error('[flow-edit-server]   FLOW_MODULE_PATH=/path/to/node_zmq_framework/lib/flow.js npm run edit-server -- flow.yml')
  console.error(`[flow-edit-server] (${err.message})`)
  process.exit(1)
}

if (!process.argv[2]) {
  console.error('Usage: node server/flow-edit-server.js /path/to/some/flow.yml [port]')
  process.exit(1)
}
const flowPath = path.resolve(process.argv[2])
const port = Number(process.argv[3] ?? 4568)

function withCors(res) {
  // Bound to 127.0.0.1 and only ever touches the local flow.yml, so an
  // open CORS policy is fine here — this is a local dev tool, not a
  // service handling untrusted input over the network.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const server = createServer(async (req, res) => {
  withCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, flowPath }))
    return
  }

  if (req.method === 'GET' && req.url === '/api/flow') {
    try {
      const flow = Flow.loadFile(flowPath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(flow.graph()))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(err.message)
    }
    return
  }

  if (req.method === 'POST' && req.url === '/api/flow') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const { nodes } = JSON.parse(body)
      const flow = new Flow(nodes)
      writeFileSync(flowPath, flow.toYamlText())
      console.log(`[flow-edit-server] wrote ${flowPath} (${nodes.length} nodes)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(err.message)
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[flow-edit-server] serving ${flowPath} on http://127.0.0.1:${port}`)
  console.log('[flow-edit-server] GET/POST /api/flow is what the viewer\'s "Save flow.yml" button talks to.')
})
