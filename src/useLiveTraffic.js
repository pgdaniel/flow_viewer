import { useCallback, useEffect, useRef, useState } from 'react'

// Connects to a flowctl --live SSE endpoint and tracks:
// - edgeFlashes: Map<edgeId, timestamp> for animated edges (cleared after timeout)
// - nodeLiveness: Map<nodeName, lastHeartbeatTimestamp> for green/gray borders
// - latestPayloads: Map<topic, payload> for details panel peek
export function useLiveTraffic(liveUrl, enabled) {
  const [edgeFlashes, setEdgeFlashes] = useState(new Map())
  const [nodeLiveness, setNodeLiveness] = useState(new Map())
  const [latestPayloads, setLatestPayloads] = useState(new Map())
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef(null)

  const connect = useCallback(() => {
    if (!liveUrl || !enabled) return

    const es = new EventSource(`${liveUrl}/events`)
    eventSourceRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (event) => {
      try {
        const { topic, payload } = JSON.parse(event.data)
        const now = Date.now()

        // Track heartbeat liveness
        if (topic === 'heartbeat' && payload.node_name) {
          setNodeLiveness((prev) => new Map(prev).set(payload.node_name, now))
        }

        // Flash edges: find all edges with this topic
        setEdgeFlashes((prev) => {
          const next = new Map(prev)
          // We don't know the exact edge IDs here, so store by topic;
          // App.jsx will match to actual edge IDs via the graph
          next.set(`topic:${topic}`, now)
          return next
        })

        // Store latest payload per topic (capped at 50 topics)
        setLatestPayloads((prev) => {
          const next = new Map(prev)
          next.set(topic, payload)
          if (next.size > 50) {
            const firstKey = next.keys().next().value
            next.delete(firstKey)
          }
          return next
        })
      } catch {
        // Malformed SSE data, ignore
      }
    }
  }, [liveUrl, enabled])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setConnected(false)
    setEdgeFlashes(new Map())
    setNodeLiveness(new Map())
    setLatestPayloads(new Map())
  }, [])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }
    return disconnect
  }, [enabled, connect, disconnect])

  // Clear old edge flashes after 1.5s
  useEffect(() => {
    if (edgeFlashes.size === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setEdgeFlashes((prev) => {
        const next = new Map()
        for (const [k, ts] of prev) {
          if (now - ts < 1500) next.set(k, ts)
        }
        return next
      })
    }, 500)
    return () => clearInterval(timer)
  }, [edgeFlashes.size])

  return { edgeFlashes, nodeLiveness, latestPayloads, connected }
}
