import { useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Keeps Tab focus inside a modal and restores focus to whatever opened it.
// `active` is the modal's open flag; the ref must point at the dialog box
// (not the backdrop), so wrapping controls stay clickable.
export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active || !ref.current) return undefined
    const node = ref.current
    const previouslyFocused = document.activeElement
    let addedTabIndex = false

    const focusables = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true',
      )

    const first = focusables()[0]
    if (first) first.focus({ preventScroll: true })
    else {
      if (!node.hasAttribute('tabindex')) {
        node.setAttribute('tabindex', '-1')
        addedTabIndex = true
      }
      node.focus({ preventScroll: true })
    }

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const idx = list.indexOf(document.activeElement)
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault()
          list[list.length - 1].focus()
        }
      } else if (idx === -1 || idx === list.length - 1) {
        e.preventDefault()
        list[0].focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (addedTabIndex) node.removeAttribute('tabindex')
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [ref, active])
}
