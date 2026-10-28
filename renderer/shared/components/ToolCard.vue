<script setup lang="ts">
import type { ToolDefinition } from '../types/tool'

defineProps<{
  tool: ToolDefinition
  isFavorite?: boolean
}>()

defineEmits<{
  click: []
  toggleFavorite: []
}>()
</script>

<template>
  <div class="tool-card" :style="{ '--tool-accent': tool.color }" @click="$emit('click')">
    <button
      class="favorite-btn"
      type="button"
      :class="{ active: isFavorite }"
      :aria-label="isFavorite ? '取消收藏' : '收藏工具'"
      :title="isFavorite ? '取消收藏' : '收藏工具'"
      @click.stop="$emit('toggleFavorite')"
    >
      <span aria-hidden="true">★</span>
    </button>
    <div class="tool-head">
      <UiAvatar :text="tool.name" :color="tool.color" :size="42" :icon="tool.icon" />
      <h3 class="tool-name">
        {{ tool.name }}
      </h3>
    </div>
    <p class="tool-desc">
      {{ tool.description }}
    </p>
    <UiGroup class="tool-meta" wrap gap="xs">
      <UiChip v-if="tool.isNew" tone="success">
        新
      </UiChip>
      <span class="tool-version">v{{ tool.version }}</span>
    </UiGroup>
  </div>
</template>

<style scoped lang="scss">
/* 浮岛卡片：头像行 + 细描边，hover 抬升 + 阴影 */
.tool-card {
  /* 收藏钮是绝对定位浮层：尺寸 / 内缩集中定义，工具名预留宽度与之联动 */
  --favorite-size: 26px;
  --favorite-inset: var(--spacing-md);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-height: 0;
  padding: var(--spacing-md) var(--spacing-lg);
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-raised);
  /* 玻璃：卡片是最常被内容滚过的一层，模糊按 raised 角色取（不透明窗口下为 none）。
     顶部 1px 高光来自 --color-highlight：不透明模式下为透明，玻璃模式才出现（Tahoe 的镜面边）。 */
  backdrop-filter: var(--glass-raised);
  box-shadow: inset 0 1px 0 var(--color-highlight), var(--shadow-sm);
  cursor: pointer;
  transition: border-color var(--transition-base), box-shadow var(--transition-base), transform var(--transition-base), opacity var(--transition-base);

  &:hover {
    /* 头像用的是工具自己的色，hover 描边同一支色：卡片在「被指向」的瞬间亮出自己的身份 */
    border-color: color-mix(in srgb, var(--tool-accent) 42%, var(--color-border));
    box-shadow: inset 0 1px 0 var(--color-highlight), var(--shadow-md);
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.99);
  }

  .favorite-btn {
    position: absolute;
    top: var(--favorite-inset);
    right: var(--favorite-inset);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--favorite-size);
    height: var(--favorite-size);
    padding: 0;
    border: 1px solid var(--color-border-light);
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: var(--transition-fast);

    &:hover {
      /* hover 只是「这个可以点」的预告：琥珀描边 + 淡底 */
      border-color: color-mix(in srgb, var(--color-warning) 45%, transparent);
      background: color-mix(in srgb, var(--color-warning) 10%, transparent);
      color: var(--color-warning);
    }

    /* 已收藏 = **实底琥珀 + 白星**：与「还在犹豫」的 hover 态拉开层级，
       白星压琥珀 4.89:1，也是全站唯一用实底琥珀的地方 */
    &.active {
      border-color: transparent;
      background: var(--color-warning);
      color: var(--color-on-solid);
    }

    &:active {
      transform: scale(0.82);
    }

    span {
      font-size: var(--font-size-sm);
      line-height: 1;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    &.active span {
      transform: scale(1.15);
    }
  }

  /* Telegram 字母头像：近白 → 工具色的纵向渐变（见 UiAvatar） */
  .tool-head {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    min-width: 0;
  }

  .tool-name {
    flex: 1;
    min-width: 0;
    /* 预留收藏钮浮层占位，避免长工具名滑到星标下方 */
    margin: 0 calc(var(--favorite-size) + var(--favorite-inset)) 0 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-desc {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    /* 单行截断，行高只决定这一行的高度；仍取 1.5，与全站说明文字同一档 */
    line-height: 1.5;
  }

  /* 元信息行固定高度：有 / 没有「新」徽章时卡片等高，首页拖拽换行不会引起行高重排 */
  .tool-meta {
    min-height: 24px;
  }

  .tool-version {
    font-size: var(--font-size-xs);
    margin-left: auto;
    color: var(--color-text-tertiary);
  }
}
</style>
