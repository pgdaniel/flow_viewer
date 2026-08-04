# flow_viewer

**A Node-RED-style graph viewer and editor for `flow.yml` manifests from
any [ruby_zmq_framework](https://github.com/pgdaniel/ruby_zmq_framework)-family
port** — [Ruby](https://github.com/pgdaniel/ruby_zmq_framework),
[Zig](https://github.com/pgdaniel/zig_zmq_framework),
[Go](https://github.com/pgdaniel/go_zmq_framework),
[Rust](https://github.com/pgdaniel/rust_zmq_framework),
[Node](https://github.com/pgdaniel/node_zmq_framework),
[C++](https://github.com/pgdaniel/cpp_zmq_framework), or
[Python](https://github.com/pgdaniel/python_zmq_framework). Every one of those
ports parses the same manifest format and can emit the same topology JSON
(`flowctl --graph`), so this viewer doesn't care which language your
flow.yml is written for — it just draws the graph.

- One box per node, colored wires between them for each topic, a dashed
  "unresolved" ghost node wherever something subscribes to a topic nobody
  publishes.
- Click a node for its full command, publishes, subscribes, and env.
- **Edit mode**: drag nodes, add/delete them, edit their command/topics/env
  in a form panel, drag a wire between two nodes to pick or create the
  topic that connects them, click a wire to remove a subscription.
- **Save**: writes straight back to your flow.yml (via an optional local
  server, see below) or, if that's not running, copies the equivalent
  YAML to your clipboard instead.

## Quick start (read-only)

```bash
npm install
npm run sync -- /path/to/some/flow.yml   # regenerate public/flow.json
npm run dev
```

Rerun `npm run sync -- ...` any time flow.yml changes on disk and refresh
the page, or use `--watch` to regenerate automatically (Vite reloads the
page when `public/flow.json` changes):

```bash
npm run sync -- --watch /path/to/some/flow.yml
``` `npm run sync` reuses
[node_zmq_framework](https://github.com/pgdaniel/node_zmq_framework)'s
`Flow` module rather than shelling out to a language-specific `flowctl`,
so clone that as a sibling of this repo first:

```bash
git clone https://github.com/pgdaniel/node_zmq_framework ../node_zmq_framework
```

(You don't need Node installed for whatever language your actual flow.yml
targets — just for this viewer and its sync/edit tooling.)

If your checkout doesn't live at `../node_zmq_framework`, point
`FLOW_MODULE_PATH` at wherever `lib/flow.js` actually is instead of
cloning it into that exact spot:

```bash
FLOW_MODULE_PATH=/path/to/node_zmq_framework/lib/flow.js npm run sync -- /path/to/some/flow.yml
```

(`npm run edit-server`, below, honors the same variable.)

## Editing and saving

Click **Edit** in the toolbar to turn on dragging, the node/wire editing
described above, and a **Save flow.yml** button. That button POSTs your
edits to an optional local server that writes them straight to disk:

```bash
npm run edit-server -- /path/to/some/flow.yml
```

This is **entirely optional** — `npm install`, `npm run dev`, and
`npm run build` never require it, and it's not a dependency of the app in
any way. Without it running, **Save flow.yml** just copies the equivalent
YAML to your clipboard instead, so you can paste it in by hand. Like
`sync`, the edit server reuses node_zmq_framework's `Flow` module (its
`toYamlText()` is what makes writing the manifest back out possible) —
same sibling-clone requirement as above.

**Tip**: with the edit server running, you can skip `npm run sync` entirely
and point the viewer directly at it: open
`http://localhost:5173/?flow=http://localhost:4568/api/flow` (or whatever
port your edit server is on). The viewer fetches the graph over HTTP
instead of from `public/flow.json`.

The YAML this produces round-trips through all five ports' parsers —
verified by writing an edited flow.yml with this tool and confirming
Ruby, Zig, Go, Rust, and Node's own `flowctl --plan` all compute identical
wiring from it.

### Why wires aren't quite what they look like

flow.yml's wiring is topic-based pub/sub, not point-to-point — a topic
can have several publishers and several subscribers. So a "wire" you drag
between two nodes isn't a literal connection; it's shorthand for "make
the source publish this topic and the target subscribe to it," and
clicking a wire to delete it removes that *subscription*, which affects
every publisher of that topic into that node, not just the one edge you
clicked. The editor's topic-picker modal makes this explicit rather than
pretending otherwise.

## Why this is a separate repo

The viewer only ever reads/writes the graph JSON shape and the flow.yml
text format — both are common ground across all five language ports, so
it doesn't belong inside any one of them. `src/graphModel.js` is a small,
dependency-free duplicate of the wiring/graph/YAML-serialization logic in
node_zmq_framework's `lib/flow.js` (kept in sync deliberately — see the
comment at the top of that file) so that viewing and editing work with
*zero* new npm dependencies; only the optional save-to-disk path reaches
for node_zmq_framework directly.

## Development

```bash
npm run lint    # oxlint
npm run build   # production build to dist/
npm test        # vitest run
```

`src/graphModel.test.js` covers `deriveGraph`/`allTopics`/`toYamlText`/
`quoteIfNeeded`/`isValidToken`/`validateFlow` directly.
`src/graphModel.integration.test.js` is a drift detector for the mirror
described above: when a `node_zmq_framework` clone is present as a
sibling directory it feeds identical input through both implementations

`npm run build` always runs a `postbuild` step
(`scripts/strip-dev-flow-json.mjs`) that deletes `dist/flow.json` —
whatever sample `public/flow.json` a developer last synced locally would
otherwise ship baked into the build. At runtime the app loads flow data
from a `?flow=` query param (defaulting to `/flow.json`), or a file you
hand it directly if that fails to load, so a deployed build was never
meant to bundle one fixed flow.json anyway.
and asserts identical output, and skips cleanly otherwise.
