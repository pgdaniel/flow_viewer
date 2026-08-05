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
import { writeFileSync, readdirSync, statSync } from 'node:fs'
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

const discoveryRoot = process.env.FLOW_DISCOVERY_ROOT
  ? path.resolve(process.env.FLOW_DISCOVERY_ROOT)
  : path.resolve(here, '../..')

// Resolves a path: if it's a directory, appends flow.yml. Returns the
// resolved path or null if the file doesn't exist.
function resolveFlowPath(requestedPath) {
  const resolved = path.resolve(requestedPath)
  let stat
  try {
    stat = statSync(resolved)
  } catch {
    return null
  }
  if (stat.isDirectory()) {
    const flowFile = path.join(resolved, 'flow.yml')
    try {
      statSync(flowFile)
      return flowFile
    } catch {
      return null
    }
  }
  return resolved
}

// Scans the discovery root for flow.yml files in sibling repos.
// Returns an array of { path, label } objects. The path is the directory
// containing flow.yml (not the file itself), so the UI shows cleaner labels.
// Skips node_modules, dot-dirs.
function discoverFlows() {
  const results = []
  const skip = new Set(['node_modules', '.git'])

  function scanDir(dir, depth) {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (skip.has(name) || name.startsWith('.')) continue
      const full = path.join(dir, name)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        scanDir(full, depth + 1)
      } else if (name === 'flow.yml') {
        const dirPath = path.dirname(full)
        const rel = path.relative(discoveryRoot, dirPath)
        results.push({ path: dirPath, label: rel || '.' })
      }
    }
  }

  scanDir(discoveryRoot, 0)
  return results.sort((a, b) => a.label.localeCompare(b.label))
}

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

  if (req.method === 'GET' && req.url === '/api/flows') {
    const flows = discoverFlows()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(flows))
    return
  }

  // Load flow from any path (user explicitly typed it, so no discovery-set check)
  if (req.method === 'GET' && req.url.startsWith('/api/flow/resolve')) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const requestedPath = url.searchParams.get('path')
    if (!requestedPath) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing path parameter')
      return
    }

    const targetPath = resolveFlowPath(requestedPath)
    if (!targetPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('flow.yml not found at path')
      return
    }

    try {
      const flow = Flow.loadFile(targetPath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(flow.graph()))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(err.message)
    }
    return
  }

  if (req.method === 'GET' && req.url.startsWith('/api/flow')) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const requestedPath = url.searchParams.get('path')
    let targetPath

    if (requestedPath) {
      // Validate that the requested path is in the discovered set
      const discovered = discoverFlows()
      const match = discovered.find((f) => f.path === requestedPath)
      if (!match) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Path not in discovered flows')
        return
      }
      targetPath = resolveFlowPath(requestedPath)
      if (!targetPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('flow.yml not found in directory')
        return
      }
    } else {
      targetPath = flowPath
    }

    try {
      const flow = Flow.loadFile(targetPath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(flow.graph()))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(err.message)
    }
    return
  }

  if (req.method === 'POST' && req.url.startsWith('/api/flow')) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const requestedPath = url.searchParams.get('path')
    let targetPath

    if (requestedPath) {
      // Validate that the requested path is in the discovered set
      const discovered = discoverFlows()
      const match = discovered.find((f) => f.path === requestedPath)
      if (!match) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Path not in discovered flows')
        return
      }
      targetPath = resolveFlowPath(requestedPath)
      if (!targetPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('flow.yml not found in directory')
        return
      }
    } else {
      targetPath = flowPath
    }

    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const { nodes } = JSON.parse(body)
      const flow = new Flow(nodes)
      writeFileSync(targetPath, flow.toYamlText())
      console.log(`[flow-edit-server] wrote ${targetPath} (${nodes.length} nodes)`)
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
