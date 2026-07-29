import { useEscapeToClose } from './useEscapeToClose.js'

// Generic replacement for window.confirm() — same backdrop/modal
// structure as WireModal, just a message and a confirm/cancel pair.
export function ConfirmModal({ message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  useEscapeToClose(onCancel)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal__hint">{message}</p>
        <div className="modal__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="modal__confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
