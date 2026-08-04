import { useCallback, useState } from 'react'
import { isValidFlowJson } from './graphModel.js'

export function mapGraphToNodes(graph) {
  return graph.nodes.map((n) => ({
    name: n.name,
    cmd: n.cmd,
    publishes: [...n.publishes],
    subscribes: [...n.subscribes],
    env: { ...n.env },
  }))
}

// Loads flow.json from a source URL, validates shape, and returns nodes.
// Used by App for initial load, manual reload, and focus-triggered refetch.
export function useFlowLoader() {
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (source) => {
    setLoading(true)
    try {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const graph = await res.json()
      if (!isValidFlowJson(graph)) {
        throw new Error(`${source} is not shaped like a flow graph (expected { nodes: [...] })`)
      }
      return mapGraphToNodes(graph)
    } finally {
      setLoading(false)
    }
  }, [])

  return { load, loading }
}
