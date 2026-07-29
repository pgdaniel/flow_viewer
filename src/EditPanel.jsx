import { useState } from 'react'

// A chip-style list editor for a node's publishes/subscribes: existing
// topics render as removable pills, an input + Enter (or the suggestion
// datalist) adds a new one.
function TopicChips({ label, topics, suggestions, onAdd, onRemove }) {
  const [draft, setDraft] = useState('')
  const listId = `topics-${label}`

  const commit = () => {
    const topic = draft.trim()
    if (topic && !topics.includes(topic)) onAdd(topic)
    setDraft('')
  }

  return (
    <div className="edit-field">
      <label>{label}</label>
      <div className="chip-list">
        {topics.map((t) => (
          <span className="chip" key={t}>
            {t}
            <button type="button" className="chip__remove" onClick={() => onRemove(t)} aria-label={`remove ${t}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="chip-input">
        <input
          list={listId}
          value={draft}
          placeholder="add a topic…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <datalist id={listId}>
          {suggestions.map((t) => (
            <option value={t} key={t} />
          ))}
        </datalist>
        <button type="button" onClick={commit} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}

function EnvRows({ env, onChange }) {
  const entries = Object.entries(env)

  const setEntries = (next) => onChange(Object.fromEntries(next))

  return (
    <div className="edit-field">
      <label>Env</label>
      {entries.map(([k, v], i) => (
        <div className="env-row" key={i}>
          <input
            value={k}
            placeholder="KEY"
            onChange={(e) => {
              const next = [...entries]
              next[i] = [e.target.value, v]
              setEntries(next)
            }}
          />
          <input
            value={v}
            placeholder="value"
            onChange={(e) => {
              const next = [...entries]
              next[i] = [k, e.target.value]
              setEntries(next)
            }}
          />
          <button type="button" onClick={() => setEntries(entries.filter((_, j) => j !== i))} aria-label="remove">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setEntries([...entries, ['', '']])}>
        + Add env var
      </button>
    </div>
  )
}

// The editable counterpart to the read-only details panel: cmd,
// publishes/subscribes chip editors, env key/value rows, rename, and
// delete. `node` is the current logical node data (not a React Flow
// object); `onChange` receives the fully-updated node.
export function EditPanel({ node, siblingNames, allTopics, onChange, onDelete, onClose }) {
  const [name, setName] = useState(node.name)
  const [renameError, setRenameError] = useState(null)

  const commitRename = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setName(node.name)
      setRenameError(null)
      return
    }
    if (trimmed === node.name) {
      setRenameError(null)
      return
    }
    if (siblingNames.includes(trimmed)) {
      setRenameError(`a node named "${trimmed}" already exists`)
      return
    }
    setRenameError(null)
    onChange({ ...node, name: trimmed })
  }

  return (
    <aside className="details details--edit">
      <button className="details__close" onClick={onClose}>
        ×
      </button>

      <div className="edit-field">
        <label>Name</label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (renameError) setRenameError(null)
          }}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {renameError && <p className="edit-field__error">{renameError}</p>}
      </div>

      <div className="edit-field">
        <label>Command</label>
        <input value={node.cmd} onChange={(e) => onChange({ ...node, cmd: e.target.value })} placeholder="ruby nodes/foo.rb" />
      </div>

      <TopicChips
        label="Publishes"
        topics={node.publishes}
        suggestions={allTopics}
        onAdd={(t) => onChange({ ...node, publishes: [...node.publishes, t] })}
        onRemove={(t) => onChange({ ...node, publishes: node.publishes.filter((x) => x !== t) })}
      />

      <TopicChips
        label="Subscribes"
        topics={node.subscribes}
        suggestions={allTopics}
        onAdd={(t) => onChange({ ...node, subscribes: [...node.subscribes, t] })}
        onRemove={(t) => onChange({ ...node, subscribes: node.subscribes.filter((x) => x !== t) })}
      />

      <EnvRows env={node.env} onChange={(env) => onChange({ ...node, env })} />

      <button type="button" className="details__delete" onClick={() => onDelete(node.name)}>
        Delete node
      </button>
    </aside>
  )
}
