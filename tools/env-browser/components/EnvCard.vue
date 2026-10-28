<script setup lang="ts">
import type { EnvConfig } from '../stores/envStore'

defineProps<{
  env: EnvConfig
  active?: boolean
  opened?: boolean
}>()

const emit = defineEmits<{
  open: [env: EnvConfig]
  edit: [env: EnvConfig]
  delete: [env: EnvConfig]
}>()
</script>

<template>
  <UiListCard
    :active="active"
    @click="emit('open', env)"
  >
    <div class="card-header">
      <span class="name">{{ env.name }}</span>
      <UiChip v-if="opened" tone="success" variant="soft">
        已打开
      </UiChip>
    </div>
    <div class="card-url" :title="env.url">
      {{ env.url }}
    </div>
    <div class="card-meta">
      <span class="muted">{{ env.username }}</span>
      <span class="muted remark">{{ env.remark || '' }}</span>
    </div>
    <div class="card-actions" @click.stop>
      <el-button size="small" link type="primary" @click="emit('edit', env)">
        编辑
      </el-button>
      <el-button size="small" link type="danger" @click="emit('delete', env)">
        删除
      </el-button>
      <el-button size="small" type="primary" plain @click="emit('open', env)">
        打开
      </el-button>
    </div>
  </UiListCard>
</template>

<style scoped lang="scss">
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}

.name {
  min-width: 0;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-url {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: var(--spacing-sm);
}

.card-meta {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
  font-size: var(--font-size-sm);
}

.remark {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  display: flex;
  gap: var(--spacing-xs);
  justify-content: flex-end;
}
</style>
