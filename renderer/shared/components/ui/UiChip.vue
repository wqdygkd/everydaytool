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
     --chip-tone = 图形档（浅底 / 描边，可以亮）；--chip-ink = 可读档（文字 / 实底，≥4.5:1）。
     两档的分工见 tokens.scss 的色阶规则：状态胶囊是 11px 文字，永远取 ink。
     neutral 的 ink 取**次级**文本而不是三级：三级压在自己 10% 的灰底上只有 4.4:1。 */
  --chip-tone: var(--color-text-tertiary);
  --chip-ink: var(--color-text-secondary);

  display: inline-flex;
  align-items: center;
  padding: 2px var(--spacing-sm);
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-raised);
  color: var(--chip-ink);
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
    --chip-ink: var(--color-primary-strong);
  }

  /* 语义色只有一档（本身就是墨档）：图形与文字同色，浅底由它淡出 */
  &.is-success {
    --chip-tone: var(--color-success);
    --chip-ink: var(--color-success);
  }

  &.is-warning {
    --chip-tone: var(--color-warning);
    --chip-ink: var(--color-warning);
  }

  &.is-danger {
    --chip-tone: var(--color-error);
    --chip-ink: var(--color-error);
  }

  &.is-variant-soft {
    border-color: color-mix(in srgb, var(--chip-tone) 30%, transparent);
    background: color-mix(in srgb, var(--chip-tone) 10%, transparent);
    color: var(--chip-ink);
  }

  &.is-variant-outline {
    border-color: color-mix(in srgb, var(--chip-tone) 45%, transparent);
    background: transparent;
    color: var(--chip-ink);
  }

  /* neutral 的描边态用中性边框色，不拿灰字做 35% 混色（会偏浅到看不出边界） */
  &.is-neutral.is-variant-outline {
    border-color: var(--color-border-light);
    background: var(--color-raised);
    color: var(--color-text-secondary);
  }

  /* Telegram 未读徽章式实底胶囊：实底取墨档，白字才能达标（绿底白字 4.97:1） */
  &.is-variant-solid {
    padding: 1px var(--spacing-sm);
    border-color: transparent;
    background: var(--chip-ink);
    color: var(--color-on-solid);
    font-weight: var(--font-weight-medium);
  }
}
</style>
