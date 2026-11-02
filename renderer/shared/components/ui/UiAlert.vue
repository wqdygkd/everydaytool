<script setup lang="ts">
// 提示条内核：语义浅底块（图标 + 标题 + 描述）。closable 仅保持 API 兼容（恒不关闭）。
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  type?: 'success' | 'warning' | 'error' | 'info'
  title?: string
  description?: string
  closable?: boolean
  showIcon?: boolean
}>(), {
  type: 'info',
  title: undefined,
  description: undefined,
  closable: false,
  showIcon: false,
})

const iconName = computed(() => (props.type === 'error' || props.type === 'warning') ? 'alert' : 'info')
</script>

<template>
  <div class="ui-alert" :class="`is-${type}`" role="alert">
    <UiIcon v-if="showIcon" :name="iconName" :size="15" class="ui-alert-icon" />
    <div class="ui-alert-body">
      <p v-if="title" class="ui-alert-title">
        {{ title }}
      </p>
      <p v-if="description" class="ui-alert-desc">
        {{ description }}
      </p>
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
/* 语义浅底 = 自身色 10%(DESIGN §3.1:每个语义值都验算过「白底 + 自身浅底」双落点) */
.ui-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.ui-alert-icon {
  flex: none;
  margin-top: 1px;
}

.ui-alert-title {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.ui-alert-desc {
  margin-top: var(--spacing-xs);
  color: var(--color-text-secondary);
}

.is-error {
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
  .ui-alert-icon { color: var(--color-error); }
}

.is-warning {
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  .ui-alert-icon { color: var(--color-warning); }
}

.is-success {
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  .ui-alert-icon { color: var(--color-success); }
}

.is-info {
  background: var(--color-primary-soft);
  .ui-alert-icon { color: var(--color-primary-strong); }
}
</style>
