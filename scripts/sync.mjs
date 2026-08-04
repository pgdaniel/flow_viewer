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
//   npm run sync -- --watch /path/to/some/flow.yml
import { writeFileSync } from 'node:fs'
import { watch } from 'node:fs'
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
  console.error(`[sync] Couldn't load node_zmq_framework's Flow module from ${flowModulePath}`)
  console.error('[sync] Clone it as a sibling of this repo to use this script:')
  console.error('[sync]   git clone https://github.com/pgdaniel/node_zmq_framework ../node_zmq_framework')
  console.error('[sync] ...or point FLOW_MODULE_PATH at wherever your checkout lives:')
  console.error('[sync]   FLOW_MODULE_PATH=/path/to/node_zmq_framework/lib/flow.js npm run sync -- flow.yml')
  console.error(`[sync] (${err.message})`)
  process.exit(1)
}

const args = process.argv.slice(2)
const watchMode = args.includes('--watch')
const flowArg = args.find((a) => a !== '--watch')

if (!flowArg) {
  console.error('Usage: npm run sync -- [--watch] /path/to/some/flow.yml')
  process.exit(1)
}

const flowPath = path.resolve(flowArg)
const outPath = path.join(here, '../public/flow.json')

function regenerate() {
  try {
    const flow = Flow.loadFile(flowPath)
    writeFileSync(outPath, JSON.stringify(flow.graph(), null, 2))
    console.log(`[sync] wrote ${outPath} from ${flowPath}`)
  } catch (err) {
    console.error(`[sync] ${err.message}`)
  }
}

regenerate()

if (watchMode) {
  const dir = path.dirname(flowPath)
  const basename = path.basename(flowPath)
  let debounceTimer = null
  console.log(`[sync] watching ${flowPath} for changes...`)
  watch(dir, { persistent: true }, (eventType, filename) => {
    if (filename !== basename) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(regenerate, 100)
  })
}
