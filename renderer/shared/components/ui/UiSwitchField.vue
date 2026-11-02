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
    <!-- 开关内核：原生 role=switch。轨道可半透明、滑块近实（DESIGN §3.1.3），着色走开关专属三档令牌 -->
    <button
      type="button"
      role="switch"
      class="ui-switch"
      :class="{ 'is-on': value, 'is-disabled': disabled }"
      :aria-checked="value"
      :disabled="disabled"
      @click="value = !value"
    >
      <span class="ui-switch-knob" />
    </button>
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

    /* 但两个盒子高度不等：开关根节点占了整个控件高度（32px），
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

.ui-switch {
  --ui-switch-w: 40px;
  --ui-switch-h: 20px;

  position: relative;
  flex: none;
  width: var(--ui-switch-w);
  height: var(--ui-switch-h);
  padding: 0;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  background: var(--color-switch-track-off);
  box-shadow: inset 0 1px 0 var(--color-highlight);
  transition: background var(--transition-fast);

  &.is-on {
    background: var(--color-switch-track);
  }

  &.is-disabled {
    cursor: not-allowed;
    background: color-mix(in oklab, var(--color-switch-track-off) 55%, transparent);

    &.is-on {
      background: color-mix(in oklab, var(--color-switch-track) 55%, transparent);
    }
  }
}

.ui-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(var(--ui-switch-h) - 4px);
  height: calc(var(--ui-switch-h) - 4px);
  border-radius: 50%;
  background: var(--color-switch-knob);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), inset 0 1px 0 var(--color-highlight);
  transition: transform var(--transition-fast);

  .is-on & {
    transform: translateX(calc(var(--ui-switch-w) - var(--ui-switch-h)));
  }
}
</style>
