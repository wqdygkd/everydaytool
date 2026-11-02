<script setup lang="ts">
// 消息框：基于平台 UiDialog 的确认 / 输入弹窗。
// 命令式入口见 shared/feedback/useConfirm.ts。
import { computed, ref, watch } from 'vue'
import UiDialog from './UiDialog.vue'

const props = withDefaults(defineProps<{
  /** 可见性(v-model) */
  modelValue?: boolean
  title?: string
  message?: string
  type?: 'success' | 'warning' | 'error' | 'info'
  showInput?: boolean
  inputType?: 'text' | 'password'
  inputPlaceholder?: string
  inputValue?: string
  confirmText?: string
  cancelText?: string
}>(), {
  modelValue: false,
  title: '',
  message: '',
  type: 'info',
  showInput: false,
  inputType: 'text',
  inputPlaceholder: '',
  inputValue: '',
  confirmText: '确定',
  cancelText: '取消',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': [inputValue: string]
  'cancel': []
  'update:inputValue': [value: string]
}>()

const inputModel = ref(props.inputValue)

watch(() => props.modelValue, (open) => {
  if (open) {
    inputModel.value = props.inputValue
  }
})

watch(() => props.inputValue, (v) => {
  inputModel.value = v
})

const inputPassthroughType = computed(() => props.inputType)

function onConfirm() {
  emit('update:inputValue', inputModel.value)
  emit('confirm', inputModel.value)
  emit('update:modelValue', false)
}

function onCancel() {
  emit('cancel')
  emit('update:modelValue', false)
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
      :input-type="inputPassthroughType"
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
