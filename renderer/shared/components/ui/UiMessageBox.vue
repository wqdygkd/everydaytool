<script setup lang="ts">
// 消息框：基于平台 UiDialog 的确认 / 输入弹窗。
// 命令式入口见 shared/feedback/useConfirm.ts。
import { ref, watch } from 'vue'
import UiDialog from './UiDialog.vue'

withDefaults(defineProps<{
  title?: string
  message?: string
  type?: 'success' | 'warning' | 'error' | 'info'
  showInput?: boolean
  inputType?: 'text' | 'password'
  inputPlaceholder?: string
  confirmText?: string
  cancelText?: string
}>(), {
  title: '',
  message: '',
  type: 'info',
  showInput: false,
  inputType: 'text',
  inputPlaceholder: '',
  confirmText: '确定',
  cancelText: '取消',
})

const emit = defineEmits<{
  confirm: [inputValue: string]
  cancel: []
}>()

const modelValue = defineModel<boolean>({ default: false })
const inputValue = defineModel<string>('inputValue', { default: '' })

const inputModel = ref(inputValue.value)

watch(modelValue, (open) => {
  if (open) {
    inputModel.value = inputValue.value
  }
})

watch(inputValue, (v) => {
  inputModel.value = v
})

function onConfirm() {
  inputValue.value = inputModel.value
  emit('confirm', inputModel.value)
  modelValue.value = false
}

function onCancel() {
  emit('cancel')
  modelValue.value = false
}
</script>

<template>
  <UiDialog
    :model-value="modelValue"
    :title="title"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="(value: boolean) => !value && onCancel()"
  >
    <p class="ui-message-box-message">
      {{ message }}
    </p>
    <UiInput
      v-if="showInput"
      v-model="inputModel"
      class="ui-message-box-input"
      :input-type="inputType"
      :placeholder="inputPlaceholder"
      @keydown.enter="onConfirm()"
    />
    <template #footer>
      <UiButton @click="onCancel()">
        {{ cancelText }}
      </UiButton>
      <UiButton type="primary" @click="onConfirm()">
        {{ confirmText }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.ui-message-box-message {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  line-height: 1.5;
}

.ui-message-box-input {
  width: 100%;
  margin-top: var(--spacing-md);
}
</style>
