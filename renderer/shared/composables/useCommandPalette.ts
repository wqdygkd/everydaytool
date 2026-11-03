import { nextTick, ref } from 'vue'

const open = ref(false)
const query = ref('')
let returnFocus: HTMLElement | null = null

function openPalette(initialQuery = '') {
  const active = document.activeElement
  returnFocus = active instanceof HTMLElement ? active : null
  query.value = initialQuery
  open.value = true
}

function closePalette(restoreFocus = true) {
  open.value = false
  if (!restoreFocus) {
    returnFocus = null
    return
  }

  const target = returnFocus
  returnFocus = null
  void nextTick(() => target?.focus())
}

export function useCommandPalette() {
  return {
    open,
    query,
    openPalette,
    closePalette,
  }
}
