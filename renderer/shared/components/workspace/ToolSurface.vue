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
  /* 毛玻璃表面：60% 白纸压在被系统糊过的壁纸上（macOS vibrancy / Windows acrylic），
     透出的 8% 是柔光而不是清晰的壁纸边缘——「生硬」正是从清晰边缘来的。
     不加顶部高光线、不画外阴影：玻璃的层次由模糊 + 半透明白给出，不靠亮边。
     透度由 --alpha-sheet 单点调档。 */
  background: var(--color-sheet);
  backdrop-filter: var(--glass-raised);
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
