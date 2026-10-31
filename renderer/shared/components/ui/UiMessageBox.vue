<script setup lang="ts">
// 消息框:基于 UiAlertDialog(shadcn alert-dialog 结构)的确认 / 输入弹窗,
// 按钮与输入使用自家 UiButton / UiInput。命令式入口见 shared/feedback/useConfirm.ts。
import { computed, ref, watch } from 'vue'
import UiAlertDialog from './UiAlertDialog.vue'
import UiAlertDialogAction from './UiAlertDialogAction.vue'
import UiAlertDialogCancel from './UiAlertDialogCancel.vue'
import UiAlertDialogContent from './UiAlertDialogContent.vue'
import UiAlertDialogDescription from './UiAlertDialogDescription.vue'
import UiAlertDialogFooter from './UiAlertDialogFooter.vue'
import UiAlertDialogHeader from './UiAlertDialogHeader.vue'
import UiAlertDialogTitle from './UiAlertDialogTitle.vue'

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
  <UiAlertDialog :open="modelValue" @update:open="(v: boolean) => !v && onCancel()">
    <UiAlertDialogContent>
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>{{ title }}</UiAlertDialogTitle>
        <UiAlertDialogDescription class="whitespace-pre-wrap break-words">
          {{ message }}
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiInput
        v-if="showInput"
        v-model="inputModel"
        :input-type="inputPassthroughType"
        :placeholder="inputPlaceholder"
        @keydown.enter="onConfirm()"
      />
      <UiAlertDialogFooter>
        <UiAlertDialogCancel as-child>
          <UiButton @click="onCancel()">
            {{ cancelText }}
          </UiButton>
        </UiAlertDialogCancel>
        <UiAlertDialogAction as-child>
          <UiButton type="primary" @click="onConfirm()">
            {{ confirmText }}
          </UiButton>
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>
</template>
