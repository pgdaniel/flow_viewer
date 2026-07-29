import { useEffect } from 'react'

// Closes a modal/panel on Escape. Shared by every modal so the behavior
// (and its later reuse for ConfirmModal/PromptModal) stays in one place.
export function useEscapeToClose(onClose) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}
