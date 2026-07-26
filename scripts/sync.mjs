#!/usr/bin/env node
// Regenerates public/flow.json from a flow.yml, so the viewer has
// something to load on `npm run dev`. Works against a flow.yml from any
// of the five ports (Ruby, Zig, Go, Rust, Node) — the graph shape is
// identical no matter which one wrote it. Reuses node_zmq_framework's
// Flow module rather than shelling out to a language-specific flowctl,
// so this script only needs node_zmq_framework cloned as a sibling of
// this repo, not a full toolchain for whichever language your flow.yml
// happens to be written for.
//
//   npm run sync -- /path/to/some/flow.yml
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const flowModulePath = path.join(here, '../../node_zmq_framework/lib/flow.js')

let Flow
try {
  ;({ Flow } = await import(flowModulePath))
} catch (err) {
  console.error(`[sync] Couldn't load node_zmq_framework's Flow module from ${flowModulePath}`)
  console.error('[sync] Clone it as a sibling of this repo to use this script:')
  console.error('[sync]   git clone https://github.com/pgdaniel/node_zmq_framework ../node_zmq_framework')
  console.error(`[sync] (${err.message})`)
  process.exit(1)
}

if (!process.argv[2]) {
  console.error('Usage: npm run sync -- /path/to/some/flow.yml')
  process.exit(1)
}

const flowPath = path.resolve(process.argv[2])
const flow = Flow.loadFile(flowPath)
const outPath = path.join(here, '../public/flow.json')
writeFileSync(outPath, JSON.stringify(flow.graph(), null, 2))
console.log(`[sync] wrote ${outPath} from ${flowPath}`)
