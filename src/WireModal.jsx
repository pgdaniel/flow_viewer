import { useState } from 'react'
import { isValidToken } from './graphModel.js'

// Shown when the user drags a wire between two nodes. Edges in this
// system aren't literal point-to-point connections — they're *derived*
// from topic-based pub/sub, so "drawing a wire" really means "make the
// source publish some topic and the target subscribe to it." This modal
// is that translation: pick a topic the source already publishes, or
// type a new one.
export function WireModal({ sourceName, targetName, sourcePublishes, onConfirm, onCancel }) {
  const [topic, setTopic] = useState(sourcePublishes[0] ?? '')
  const trimmed = topic.trim()
  const invalid = trimmed !== '' && !isValidToken(trimmed)

  const confirm = () => {
    if (trimmed && !invalid) onConfirm(trimmed)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Wire {sourceName} → {targetName}
        </h3>
        <p className="modal__hint">
          Picks or creates the topic <strong>{sourceName}</strong> publishes and <strong>{targetName}</strong>{' '}
          subscribes to.
        </p>

        {sourcePublishes.length > 0 && (
          <div className="modal__existing">
            {sourcePublishes.map((t) => (
              <button
                type="button"
                key={t}
                className={`chip chip--pickable${t === topic ? ' chip--picked' : ''}`}
                onClick={() => setTopic(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <input
          autoFocus
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="topic name"
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
        />
        {invalid && <p className="modal__error">topic can only contain letters, numbers, "_", ".", "-"</p>}

        <div className="modal__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="modal__confirm" onClick={confirm} disabled={!trimmed || invalid}>
            Wire it
          </button>
        </div>
      </div>
    </div>
  )
}
