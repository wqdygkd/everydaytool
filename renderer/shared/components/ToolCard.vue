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
  <div class="tool-card" @click="$emit('click')">
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
      <UiAvatar :text="tool.name" :color="tool.color" :size="42" />
      <h3 class="tool-name">
        {{ tool.name }}
      </h3>
    </div>
    <p class="tool-desc">
      {{ tool.description }}
    </p>
    <UiGroup wrap gap="xs">
      <span class="tool-category">{{ tool.category.name }}</span>
      <UiChip v-if="tool.isNew" tone="success">
        新
      </UiChip>
      <span class="tool-version">v{{ tool.version }}</span>
    </UiGroup>
  </div>
</template>

<style scoped lang="scss">
/* Telegram 聊天条目式卡片：白底浮岛 + 头像行，hover 灰底轻提示 */
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
  background: var(--color-surface-raised);
  cursor: pointer;
  transition: background-color var(--transition-base), border-color var(--transition-base), transform var(--transition-base);

  &:hover {
    border-color: var(--color-border);
    background: var(--color-muted);
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
    background: color-mix(in srgb, var(--color-surface-raised) 92%, transparent);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: var(--transition-fast);

    &:hover,
    &.active {
      border-color: var(--color-warning);
      background: color-mix(in srgb, var(--color-warning) 10%, var(--color-surface-raised));
      color: var(--color-warning);
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
    line-height: 1.4;
  }

  .tool-category,
  .tool-version {
    font-size: var(--font-size-xs);
  }

  .tool-category {
    color: var(--color-text-secondary);
  }

  .tool-version {
    margin-left: auto;
    color: var(--color-text-tertiary);
  }
}
</style>
