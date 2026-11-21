<script setup lang="ts">
import type { OutlookRegisterTabKey } from '../tabs'
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { useToolPath } from '@renderer/shared/composables/useToolPath'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceSpine from '../../../../renderer/shared/components/workspace/WorkspaceSpine.vue'
import OutlookAddAccountDialog from '../components/OutlookAddAccountDialog.vue'
import OutlookMailboxPanel from '../components/OutlookMailboxPanel.vue'
import OutlookRegisterPanel from '../components/OutlookRegisterPanel.vue'
import OutlookSettingsDialog from '../components/OutlookSettingsDialog.vue'
import { useOutlookRegisterStore } from '../stores/outlookRegisterStore'
import { OUTLOOK_REGISTER_TABS, outlookTabKeyFromPath } from '../tabs'

const router = useRouter()
const store = useOutlookRegisterStore()
const toolPath = useToolPath()
const paneActive = useToolPaneActive()

const activeTab = computed<OutlookRegisterTabKey>(() => outlookTabKeyFromPath(toolPath.value))
const mailboxActive = computed(() => paneActive.value && activeTab.value === 'mailbox')
const settingsOpen = ref(false)
const addOpen = ref(false)

const spineItems = computed(() => OUTLOOK_REGISTER_TABS.map(tab => ({
  key: tab.key,
  label: tab.label,
  count: tab.key === 'mailbox' ? store.accounts.length : undefined,
})))

const topbarState = computed(() => {
  if (activeTab.value === 'mailbox') {
    return `${store.accounts.length} 个账号`
  }
  return '注册资料'
})

function switchTab(key: string): void {
  const tab = OUTLOOK_REGISTER_TABS.find(item => item.key === key)
  if (!tab || key === activeTab.value) return
  router.push({ name: tab.routeName })
}

function onSaved(accountId: string): void {
  store.selectAccount(accountId)
  router.push({ name: 'tool-outlook-register-mailbox' })
}

function onAccountAdded(accountId: string): void {
  store.selectAccount(accountId)
  router.push({ name: 'tool-outlook-register-mailbox' })
}

onMounted(async () => {
  try {
    await store.refresh()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
})
</script>

<template>
  <div class="outlook-page tool-page">
    <Teleport v-if="paneActive" defer to="#app-topbar-state">
      <span class="tb-state" :class="activeTab === 'mailbox' ? 'is-neutral' : 'is-primary'">
        <i class="tb-dot" />
        {{ topbarState }}
      </span>
    </Teleport>

    <Teleport v-if="paneActive" defer to="#app-topbar-actions">
      <UiButton v-if="activeTab === 'mailbox'" size="small" @click="addOpen = true">
        添加账号
      </UiButton>
      <UiButton size="small" @click="settingsOpen = true">
        设置
      </UiButton>
    </Teleport>

    <ToolSurface class="outlook-surface">
      <template #spine>
        <WorkspaceSpine
          :model-value="activeTab"
          :items="spineItems"
          @update:model-value="switchTab"
        />
      </template>

      <OutlookRegisterPanel
        v-show="activeTab === 'register'"
        @saved="onSaved"
      />
      <OutlookMailboxPanel
        v-show="activeTab === 'mailbox'"
        :active="mailboxActive"
        @add="addOpen = true"
      />
    </ToolSurface>

    <OutlookSettingsDialog v-model="settingsOpen" />
    <OutlookAddAccountDialog v-model="addOpen" @saved="onAccountAdded" />
  </div>
</template>

<style scoped lang="scss">
.outlook-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.outlook-surface {
  flex: 1;
  min-height: 0;
}

.tb-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  &.is-primary .tb-dot {
    background: var(--color-primary);
  }

  &.is-neutral .tb-dot {
    background: var(--color-text-tertiary);
  }
}

.tb-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
}
</style>
