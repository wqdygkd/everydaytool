import { computed, type ComputedRef } from 'vue';

export function useDialogVisible(
  props: { modelValue: boolean },
  emit: (event: 'update:modelValue', value: boolean) => void,
): ComputedRef<boolean> {
  return computed({
    get: () => props.modelValue,
    set: (value: boolean) => emit('update:modelValue', value),
  });
}
