<script setup lang="ts">
import UiMessageBox from '../components/ui/UiMessageBox.vue'
// 全局确认 / 输入弹窗宿主:App.vue 挂载一次,useConfirm 的命令式调用经
// 由 UiMessageBox(UiDialog + UiButton / UiInput)渲染。
import { settleCancel, settleConfirm, useConfirmState } from './useConfirm'

const state = useConfirmState()
</script>

<template>
  <UiMessageBox
    v-model="state.visible"
    :title="state.options.title"
    :message="state.options.message"
    :show-input="state.options.showInput"
    :input-type="state.options.inputType"
    :input-placeholder="state.options.inputPlaceholder"
    :input-value="state.inputValue"
    :confirm-text="state.options.confirmButtonText"
    :cancel-text="state.options.cancelButtonText"
    @update:input-value="state.inputValue = $event"
    @confirm="settleConfirm()"
    @cancel="settleCancel()"
  />
</template>
