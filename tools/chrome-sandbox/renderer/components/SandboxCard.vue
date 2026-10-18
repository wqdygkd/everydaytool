<script setup lang="ts">
import { hasLaunchOptions } from '../shared/launchOptions'
import { formatSandboxStatus } from '../shared/sandbox'

const props = defineProps({
  sandbox: { type: Object, required: true },
  active: { type: Boolean, default: false },
})

defineEmits(['click'])

const showLaunchOptions = computed(() => hasLaunchOptions(props.sandbox?.metadata))
</script>

<template>
  <UiListCard :active="active" @click="$emit('click')">
    <div class="card-header">
      <span class="color-dot" :style="{ background: sandbox.color }" />
      <span class="name">{{ sandbox.name }}</span>
    </div>
    <div class="card-meta">
      <span class="status" :class="sandbox.status">{{ formatSandboxStatus(sandbox.status) }}</span>
      <span v-if="sandbox.status === 'running'" class="pid">PID: {{ sandbox.chromePid || '-' }}</span>
    </div>
    <div v-if="showLaunchOptions" class="launch-options-tags">
      <el-tag v-if="sandbox.metadata?.launchOptions?.disableSafetyChecks" size="small" type="danger" effect="plain">
        禁用安全检查
      </el-tag>
      <el-tag v-if="sandbox.metadata?.launchOptions?.disableCors" size="small" type="danger" effect="plain">
        禁用 CORS
      </el-tag>
      <el-tag v-if="sandbox.metadata?.launchOptions?.customArgs" size="small" type="info" effect="plain">
        自定义参数
      </el-tag>
    </div>
  </UiListCard>
</template>

<style scoped lang="scss">
.card-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
}

.card-meta {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.status.running {
  color: var(--color-success);
}

.launch-options-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}
</style>
