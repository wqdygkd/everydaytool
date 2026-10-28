<script setup lang="ts">
import type { Sandbox } from '../../../../shared/sandbox'

withDefaults(defineProps<{
  sandboxes?: Sandbox[]
  selectedId?: string | null
}>(), {
  sandboxes: () => [],
  selectedId: null,
})

defineEmits<{
  select: [id: string]
  create: []
  settings: []
}>()
</script>

<template>
  <UiSidebar title="沙箱列表">
    <div class="sandbox-list">
      <SandboxCard
        v-for="sandbox in sandboxes"
        :key="sandbox.id"
        :sandbox="sandbox"
        :active="sandbox.id === selectedId"
        @click="$emit('select', sandbox.id)"
      />
      <UiEmpty v-if="sandboxes.length === 0" center padding="var(--spacing-lg)">
        <!-- 侧栏只有 252px：标题一句 + 一句「为什么要建」，按钮就在正下方（footer），不重复放 -->
        <template #title>
          还没有沙箱
        </template>
        每个沙箱是独立指纹的 Chrome：登录态、代理、指纹互不影响。
      </UiEmpty>
    </div>
    <template #footer>
      <el-button type="primary" class="full-width" @click="$emit('create')">
        + 新建沙箱
      </el-button>
      <el-button class="full-width" @click="$emit('settings')">
        全局设置
      </el-button>
    </template>
  </UiSidebar>
</template>

<style scoped lang="scss">
.sandbox-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  min-height: 0;
  overflow-y: auto;
}
</style>
