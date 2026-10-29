import type { WritableComputedRef } from 'vue'

/**
 * 对话框显隐的双向绑定：返回**可写** computed。
 * 类型必须是 WritableComputedRef 而不是 ComputedRef——后者把 set 侧抹掉，
 * 调用点 `visible.value = false` 会报 TS2540（只读）。
 */
export function useDialogVisible(
  props: { modelValue: boolean },
  emit: (event: 'update:modelValue', value: boolean) => void,
): WritableComputedRef<boolean> {
  return computed({
    get: () => props.modelValue,
    set: (value: boolean) => emit('update:modelValue', value),
  })
}
