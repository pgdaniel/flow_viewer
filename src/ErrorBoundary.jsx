import { Component } from 'react'

// React 19 still has no hook equivalent of getDerivedStateFromError/
// componentDidCatch, so this has to be a class. Without it, any
// render-time exception (a malformed flow.json slipping past
// isValidFlowJson, a bug in dagre's layout math, etc.) produces a blank
// white screen instead of a message the user can act on.
export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('flow_viewer crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="status status--error">
          Something went wrong: {this.state.error.message}
          <br />
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
