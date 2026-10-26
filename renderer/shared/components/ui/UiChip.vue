<script setup lang="ts">
import { computed } from 'vue'

type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
type ChipVariant = 'auto' | 'soft' | 'solid' | 'outline'

const props = withDefaults(defineProps<{
  tone?: ChipTone
  /**
   * 视觉变体：
   * - `auto`（默认）= 平台历史外观，按 tone 自动取：neutral → outline、success → solid、其余 → soft
   * - `soft` = 浅底彩字（对齐 el-tag 默认样式，用于状态列）
   * - `outline` = 透明底彩边彩字（对齐 el-tag `effect="plain"`，用于弱化标记）
   * - `solid` = 实底反白（计数 / 未读徽章）
   */
  variant?: ChipVariant
  mono?: boolean
}>(), {
  tone: 'neutral',
  variant: 'auto',
})

/** auto 的映射必须与历史视觉严格等价：neutral 描边、success 实底、其余浅底 */
const resolvedVariant = computed<Exclude<ChipVariant, 'auto'>>(() => {
  if (props.variant !== 'auto') return props.variant
  if (props.tone === 'neutral') return 'outline'
  if (props.tone === 'success') return 'solid'
  return 'soft'
})
</script>

<template>
  <span
    class="ui-chip"
    :class="[`is-${tone}`, `is-variant-${resolvedVariant}`, { 'is-mono': mono }]"
  >
    <slot />
  </span>
</template>

<style scoped lang="scss">
.ui-chip {
  /* tone 只决定「用哪个颜色」，变体决定「怎么用」——避免 tone × variant 的规则爆炸。
     --chip-tone = 底色/边框基色；--chip-soft-text = 浅底 / 描边时的前景色（实底固定反白）。 */
  --chip-tone: var(--color-text-tertiary);
  --chip-soft-text: var(--color-text-tertiary);

  display: inline-flex;
  align-items: center;
  padding: 2px var(--spacing-sm);
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-raised);
  color: var(--chip-soft-text);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  white-space: nowrap;

  &.is-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  &.is-primary,
  &.is-info {
    --chip-tone: var(--color-primary);
    --chip-soft-text: var(--color-primary);
  }

  /* 浅底 / 描边时把语义色压深一档保证对比度；实底时前景改取 --color-on-solid */
  &.is-success {
    --chip-tone: var(--color-success);
    --chip-soft-text: color-mix(in srgb, var(--color-success) 85%, #000);
  }

  &.is-warning {
    --chip-tone: var(--color-warning);
    --chip-soft-text: color-mix(in srgb, var(--color-warning) 80%, #000);
  }

  &.is-danger {
    --chip-tone: var(--color-error);
    --chip-soft-text: color-mix(in srgb, var(--color-error) 85%, #000);
  }

  &.is-variant-soft {
    border-color: color-mix(in srgb, var(--chip-tone) 35%, transparent);
    background: color-mix(in srgb, var(--chip-tone) 10%, transparent);
    color: var(--chip-soft-text);
  }

  &.is-variant-outline {
    border-color: color-mix(in srgb, var(--chip-tone) 35%, transparent);
    background: transparent;
    color: var(--chip-soft-text);
  }

  /* neutral 的描边态用中性边框色，不拿灰字做 35% 混色（会偏浅到看不出边界） */
  &.is-neutral.is-variant-outline {
    border-color: var(--color-border-light);
    background: var(--color-raised);
    color: var(--color-text-tertiary);
  }

  /* Telegram 未读徽章式实底胶囊 */
  &.is-variant-solid {
    padding: 1px var(--spacing-sm);
    border-color: transparent;
    background: var(--chip-tone);
    color: var(--color-on-solid);
    font-weight: var(--font-weight-medium);
  }
}
</style>
