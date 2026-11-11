<template>
  <section class="tool-surface" :class="{ 'has-spine': $slots.spine }">
    <slot name="spine" />
    <div class="tool-surface-main">
      <header v-if="$slots.toolbar" class="tool-surface-toolbar">
        <slot name="toolbar" />
      </header>
      <div class="tool-surface-body">
        <slot />
      </div>
      <footer v-if="$slots.statusline" class="tool-surface-statusline">
        <slot name="statusline" />
      </footer>
    </div>
  </section>
</template>

<style scoped lang="scss">
.tool-surface {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 58%, var(--color-border-light));
  border-radius: var(--radius-lg);
  /* 主区域无内边距，右下角正好压在窗口外缘：不画内圆角，交给窗口自身裁切。
     这样窗口圆角 / 最大化直角 / 无圆角平台都能自然贴合，不会露出透明楔形。 */
  border-bottom-right-radius: 0;
  background: var(--color-raised);
  backdrop-filter: var(--glass-raised);
  box-shadow: inset 0 1px 0 var(--color-highlight);
}

.tool-surface.has-spine {
  flex-direction: row;
}

.tool-surface-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tool-surface-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 var(--workspace-toolbar-height);
  min-width: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.tool-surface-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tool-surface-statusline {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex: 0 0 var(--workspace-statusline-height);
  min-width: 0;
  padding: 0 14px;
  border-top: 1px solid var(--color-border-light);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
</style>
