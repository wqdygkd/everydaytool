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
  <div class="tool-card" :style="{ '--tool-color': tool.color }" @click="$emit('click')">
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
      <div class="tool-avatar" aria-hidden="true">
        {{ tool.name.charAt(0) }}
      </div>
      <h3 class="tool-name">
        {{ tool.name }}
      </h3>
    </div>
    <p class="tool-desc">
      {{ tool.description }}
    </p>
    <div class="tool-meta">
      <span class="tool-category">{{ tool.category.name }}</span>
      <span v-if="tool.isNew" class="tool-new">新</span>
      <span class="tool-version">v{{ tool.version }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
/* Telegram 聊天条目式卡片：白底浮岛 + 头像行，hover 灰底轻提示 */
.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 12px 14px;
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
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
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
      font-size: 13px;
      line-height: 1;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    &.active span {
      transform: scale(1.15);
    }
  }

  .tool-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  /* Telegram 字母头像：近白 → 工具色的纵向渐变 */
  .tool-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    border-radius: 50%;
    background: linear-gradient(180deg, color-mix(in srgb, var(--tool-color) 75%, #fff) 0%, var(--tool-color) 100%);
    color: var(--color-surface);
    font-family: "Nunito", "Roboto", sans-serif;
    font-size: 18px;
    font-weight: 800;
    user-select: none;
  }

  .tool-name {
    flex: 1;
    min-width: 0;
    margin: 0 28px 0 0;
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

  .tool-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: var(--spacing-xs);
  }

  .tool-category,
  .tool-new,
  .tool-version {
    font-size: var(--font-size-xs);
  }

  .tool-category {
    color: var(--color-text-secondary);
  }

  /* Telegram 未读徽章式草绿胶囊 */
  .tool-new {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--color-success);
    color: var(--color-surface);
    font-weight: var(--font-weight-medium);
  }

  .tool-version {
    margin-left: auto;
    color: var(--color-text-tertiary);
  }
}
</style>
