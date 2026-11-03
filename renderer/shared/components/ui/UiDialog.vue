<script setup lang="ts">
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string
  /** 仅保持 API 兼容：reka-ui 关闭即卸载内容，行为与 true 一致 */
  destroyOnClose?: boolean
  closeOnClickModal?: boolean
  /** 仅保持 API 兼容：Portal 恒定传送到 body（弹层必须挂 html 才能吃到模式变量） */
  appendToBody?: boolean
}>(), {
  width: '560px',
  closeOnClickModal: true,
  appendToBody: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
</script>

<template>
  <DialogRoot :open="visible" @update:open="visible = $event">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 ui-dialog-overlay"
      />
      <DialogContent
        class="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ui-dialog"
        :style="{ width, maxWidth: 'calc(100vw - 32px)' }"
        :aria-describedby="undefined"
        v-bind="$attrs"
        @pointer-down-outside="(event) => { if (!closeOnClickModal) event.preventDefault() }"
      >
        <div class="ui-dialog-header">
          <DialogTitle class="ui-dialog-title">
            {{ title }}
          </DialogTitle>
          <DialogClose class="ui-dialog-close" aria-label="关闭">
            <UiIcon name="close" :size="14" />
          </DialogClose>
        </div>
        <div class="ui-dialog-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="ui-dialog-footer">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped lang="scss">
.ui-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(23, 42, 61, 0.16);
  backdrop-filter: var(--glass-veil);
}

.ui-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2001;
  border-radius: var(--radius-xl);
  background: var(--color-overlay);
  backdrop-filter: var(--glass-overlay);
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 58%, transparent);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-lg) var(--spacing-xl);
}

.ui-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.ui-dialog-title {
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
}

.ui-dialog-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;

  &:hover {
    color: var(--color-text-primary);
    background: var(--color-fill);
  }
}

.ui-dialog-body {
  margin-top: var(--spacing-md);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
}

.ui-dialog-footer {
  display: flex;
  justify-content: flex-end;
  /* 按钮间距统一由 gap 控制。 */
  gap: var(--spacing-md);
  margin-top: var(--spacing-lg);
}
</style>
