<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  disabled?: boolean
  align?: 'center' | 'start'
}>(), {
  align: 'center',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="ui-switch-field" :class="`is-align-${align}`">
    <el-switch v-model="value" :disabled="disabled" />
    <span v-if="$slots.default" class="ui-switch-hint">
      <slot />
    </span>
  </div>
</template>

<style scoped lang="scss">
.ui-switch-field {
  /* 说明文字首行行高：开关轨道的中线基准（行高与偏移补偿共用这一处） */
  --ui-switch-hint-line: calc(var(--font-size-sm) * 1.5);

  display: flex;
  gap: var(--spacing-sm);

  /* 单行说明：整块居中，文字中线天然落在轨道中线上 */
  &.is-align-center {
    align-items: center;
  }

  /* 多行说明：从首行起排，开关不跟着文字块中线漂到段落中间 */
  &.is-align-start {
    align-items: flex-start;

    /* 但两个盒子高度不等：EP 默认尺寸的 .el-switch 根节点占了整个控件高度（32px），
       20px 轨道在框内居中；12px/1.5 的首行行盒只有 18px。顶对齐会让文字首行高出轨道
       中线 7px，所以给说明文字补上这段半差 —— 首行与轨道视觉居中，后续行仍向下自然排。 */
    .ui-switch-hint {
      padding-top: calc((var(--control-height) - var(--ui-switch-hint-line)) / 2);
    }
  }
}

.ui-switch-hint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--ui-switch-hint-line);
}
</style>
