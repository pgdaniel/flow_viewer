#!/usr/bin/env node
// Vite's public-dir handling copies public/flow.json verbatim into
// dist/flow.json — whatever sample a developer happened to have synced
// locally (see scripts/sync.mjs) would otherwise ship baked into the
// production build. Now that the app can load flow.json from a runtime
// ?flow= source or a file upload (see App.jsx), a static baked-in copy
// is never the right thing to ship, so this deletes it after every build.
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const distFlowJson = path.join(here, '../dist/flow.json')

if (existsSync(distFlowJson)) {
  rmSync(distFlowJson)
  console.log('[postbuild] removed dist/flow.json (dev-only sample data, not meant to ship)')
}
