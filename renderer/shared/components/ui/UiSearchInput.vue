<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  /** pill = 胶囊搜索框（HomePage 同款）；box = 方形输入框（规则面板同款） */
  variant?: 'pill' | 'box'
  width?: string
  clearable?: boolean
  size?: number
  /** 像 v-model.trim 一样自动去除首尾空白 */
  trim?: boolean
}>(), {
  variant: 'pill',
  clearable: false,
  trim: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'enter': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', props.trim ? v.trim() : v),
})

/** pill 图标 18px 重笔画；box 图标 14px 默认笔画 */
const iconSize = computed(() => props.size ?? (props.variant === 'pill' ? 18 : 14))

function onEnter() {
  emit('enter', props.modelValue)
}

function onEsc() {
  if (props.clearable && props.modelValue) {
    emit('update:modelValue', '')
  }
}
</script>

<template>
  <!-- 搜索框内核：原生 input。底色走 --color-input（input 角色），玻璃按角色独立取档 -->
  <label
    :class="variant === 'pill' ? 'ui-search-pill' : 'ui-search-box'"
    :style="width ? { width } : undefined"
  >
    <UiIcon name="search" :size="iconSize" :stroke-width="variant === 'pill' ? 2 : undefined" />
    <input
      v-model="value"
      :placeholder="placeholder"
      @keydown.enter="onEnter"
      @keydown.esc="onEsc"
    >
    <button
      v-if="clearable && modelValue"
      type="button"
      class="ui-search-clear"
      aria-label="清空"
      @click="value = ''"
    >
      <UiIcon name="close" :size="12" />
    </button>
  </label>
</template>

<style scoped lang="scss">
/* 圆角搜索框：浮岛底 + 聚焦品牌框。
   底色走 --color-input（非弹出层控件角色）——搜索框**刻意不复用** --color-field，
   以便与通用表单输入框分开调节透明度（改 --alpha-field 不会影响这里）。
   不能写 --color-raised：那是卡片角色（acrylic 下 0.78），会比输入框更透，
   且 scoped 选择器优先级高于全局绑定、无法被覆盖修正。 */
.ui-search-pill {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  height: 54px;
  padding: 0 17px;
  border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
  border-radius: var(--radius-lg);
  background: var(--color-input);
  /* 玻璃：搜索框直接浮在画布上（没有卡片兜底），背后就是壁纸，
       故走 input 角色自己的玻璃档，不与卡片共用模糊半径 */
  backdrop-filter: var(--glass-input);
  box-shadow: inset 0 1px 0 var(--color-highlight);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast);

  &:hover {
    border-color: var(--color-border);
  }

  &:focus-within {
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
}

/* 图标色与全站输入框一致 */
.ui-search-pill > :first-child {
  color: var(--color-text-tertiary);
  flex: none;
}

.ui-search-box {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  height: var(--control-height);
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-input);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &:hover { border-color: color-mix(in oklab, var(--color-border) 60%, var(--color-text-tertiary)); }

  &:focus-within {
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
}

.ui-search-box > :first-child {
  color: var(--color-text-secondary);
  flex: none;
}

input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-base);

  &::placeholder { color: var(--color-text-tertiary); }
}

.ui-search-clear {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;

  &:hover {
    color: var(--color-text-primary);
    background: var(--color-fill);
  }
}
</style>
