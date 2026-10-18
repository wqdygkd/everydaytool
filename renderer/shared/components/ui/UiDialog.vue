<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string
  destroyOnClose?: boolean
  closeOnClickModal?: boolean
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
  <el-dialog
    v-model="visible"
    :title="title"
    :width="width"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal"
    :append-to-body="appendToBody"
    v-bind="$attrs"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <div class="ui-dialog-footer">
        <slot name="footer" />
      </div>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.ui-dialog-footer {
  display: flex;
  justify-content: flex-end;
  /* 不加 gap：保留 Element Plus 按钮间原生 12px 间距，与其它工具页一致 */
}
</style>
