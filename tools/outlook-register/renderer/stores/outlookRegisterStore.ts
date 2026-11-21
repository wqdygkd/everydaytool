import type {
  OutlookAccount,
  OutlookAccountStatus,
  OutlookDraft,
  OutlookMailboxPrepared,
  OutlookProfile,
  OutlookRegisterSettings,
  OutlookRegisterState,
  OutlookRevealedPassword,
} from '../../../../shared/outlook-register'
import { defineStore } from 'pinia'
import { invokeOutlookRegisterIpc, outlookRegisterIpcChannels } from '../ipc'

export interface OutlookAddAccountInput {
  email: string
  password: string
  recoveryEmail?: string
  note?: string
}

export const useOutlookRegisterStore = defineStore('outlookRegister/state', () => {
  const state = ref<OutlookRegisterState | null>(null)
  const loading = ref(false)
  const error = ref('')
  const selectedAccountId = ref<string | null>(null)
  const lastSavedAccountId = ref<string | null>(null)

  const accounts = computed(() => state.value?.accounts ?? [])
  const draft = computed(() => state.value?.draft ?? null)
  const settings = computed(() => state.value?.settings ?? null)
  const selectedAccount = computed(() =>
    accounts.value.find(item => item.id === selectedAccountId.value) ?? null,
  )

  function channels(): Record<string, string> {
    return outlookRegisterIpcChannels()
  }

  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    return await invokeOutlookRegisterIpc<T>(channel, ...args)
  }

  function applyState(next: OutlookRegisterState): void {
    state.value = next
    if (selectedAccountId.value && !next.accounts.some(item => item.id === selectedAccountId.value)) {
      selectedAccountId.value = next.accounts[0]?.id ?? null
    }
  }

  async function runState(channel: string, ...args: unknown[]): Promise<OutlookRegisterState> {
    loading.value = true
    error.value = ''
    try {
      const next = await invoke<OutlookRegisterState>(channel, ...args)
      applyState(next)
      return next
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    await runState(channels().GET_STATE)
    if (!selectedAccountId.value) selectedAccountId.value = accounts.value[0]?.id ?? null
  }

  async function createDraft(force = false): Promise<OutlookDraft | null> {
    const next = await runState(channels().CREATE_DRAFT, { force })
    return next.draft
  }

  async function updateDraft(patch: {
    domain?: OutlookRegisterSettings['domain']
    profile?: OutlookProfile
    recoveryEmail?: string
    password?: string
  }): Promise<void> {
    await runState(channels().UPDATE_DRAFT, patch)
  }

  async function discardDraft(): Promise<void> {
    await runState(channels().DISCARD_DRAFT, { id: draft.value?.id })
  }

  async function saveDraft(): Promise<OutlookAccount | null> {
    const previous = draft.value
    const next = await runState(channels().SAVE_ACCOUNT)
    if (!next.draft && previous) {
      const saved = next.accounts.find(item => item.id === previous.id) ?? null
      lastSavedAccountId.value = saved?.id ?? null
      if (saved) selectedAccountId.value = saved.id
      return saved
    }
    return null
  }

  async function addAccount(input: OutlookAddAccountInput): Promise<OutlookAccount | null> {
    const next = await runState(channels().ADD_ACCOUNT, input)
    const added = next.accounts.find(item => item.email === input.email.trim().toLowerCase()) ?? null
    if (added) selectedAccountId.value = added.id
    return added
  }

  async function updateAccount(id: string, patch: {
    email?: string
    password?: string
    recoveryEmail?: string
    note?: string
    status?: OutlookAccountStatus
    markMailboxOpened?: boolean
  }): Promise<void> {
    await runState(channels().UPDATE_ACCOUNT, { id, patch })
  }

  async function deleteAccount(id: string): Promise<void> {
    await runState(channels().DELETE_ACCOUNT, { id })
    if (selectedAccountId.value === id) selectedAccountId.value = accounts.value[0]?.id ?? null
  }

  async function resetSession(id: string): Promise<void> {
    await runState(channels().RESET_SESSION, { id })
  }

  async function revealPassword(id: string): Promise<OutlookRevealedPassword> {
    return await invoke<OutlookRevealedPassword>(channels().REVEAL_PASSWORD, { id })
  }

  async function updateSettings(patch: Partial<OutlookRegisterSettings>): Promise<void> {
    await runState(channels().UPDATE_SETTINGS, patch)
  }

  async function prepareMailbox(id: string): Promise<OutlookMailboxPrepared> {
    const prepared = await invoke<OutlookMailboxPrepared>(channels().PREPARE_MAILBOX, { id })
    applyState(prepared.state)
    return prepared
  }

  function selectAccount(id: string | null): void {
    selectedAccountId.value = id
  }

  function ensureSelection(): void {
    if (!selectedAccountId.value || !accounts.value.some(item => item.id === selectedAccountId.value)) {
      selectedAccountId.value = accounts.value[0]?.id ?? null
    }
  }

  return {
    state,
    loading,
    error,
    accounts,
    draft,
    settings,
    selectedAccountId,
    selectedAccount,
    lastSavedAccountId,
    refresh,
    createDraft,
    updateDraft,
    discardDraft,
    saveDraft,
    addAccount,
    updateAccount,
    deleteAccount,
    resetSession,
    revealPassword,
    updateSettings,
    prepareMailbox,
    selectAccount,
    ensureSelection,
  }
})
