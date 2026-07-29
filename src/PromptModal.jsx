import { useState } from 'react'
import { useEscapeToClose } from './useEscapeToClose.js'

// Generic replacement for window.prompt() — a single text field with a
// caller-supplied validator, so invalid input is shown inline instead of
// being silently swallowed (the old addNode() did nothing at all on a
// bad/duplicate name).
export function PromptModal({ title, label, placeholder, confirmLabel = 'Add', validate, onConfirm, onCancel }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)

  useEscapeToClose(onCancel)

  const commit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    const message = validate?.(trimmed)
    if (message) {
      setError(message)
      return
    }
    onConfirm(trimmed)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {label && <p className="modal__hint">{label}</p>}
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {error && <p className="modal__error">{error}</p>}
        <div className="modal__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="modal__confirm" onClick={commit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
