<script setup lang="ts">
import { toolRegistry } from './config/tools'

const route = useRoute()

const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
const currentToolName = computed(() => {
  const tool = toolRegistry.find(t => t.id === currentTool.value)
  return tool?.name || ''
})
const toolCount = computed(() => toolRegistry.length)
const activeLabel = computed(() => currentToolName.value || `${toolCount.value} 个工具`)
const footerLabel = computed(() => currentToolName.value || '工具总览')
const runtimeTarget = computed(() => window.edtRuntime?.target ?? 'web')
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">edt</span>
        <div>
          <span class="brand-name">everydaytool</span>
          <span class="brand-caption">本地工具工作台</span>
        </div>
      </div>
      <div class="header-meta">
        <span>{{ activeLabel }}</span>
        <span>{{ runtimeTarget }}</span>
      </div>
    </header>

    <main class="app-main">
      <router-view />
    </main>

    <footer class="app-footer">
      <span>{{ footerLabel }}</span>
      <span>ready</span>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  overflow: hidden;
  background: var(--color-app-bg);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 0 24px;
  background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-primary);
  backdrop-filter: blur(18px);

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-lg);
    background: var(--color-primary);
    color: var(--color-surface-raised);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
  }

  .brand-name,
  .brand-caption {
    display: block;
  }

  .brand-name {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.01em;
  }

  .brand-caption {
    margin-top: 1px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }

  .header-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);

    span {
      border: 1px solid var(--color-border-light);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      padding: 5px 9px;
    }
  }
}

.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 24px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-surface-raised) 82%, transparent);
  border-top: 1px solid var(--color-border-light);
}

@media (max-width: 640px) {
  .app-header {
    height: auto;
    min-height: 64px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;

    .header-meta {
      width: 100%;
      justify-content: space-between;
    }
  }
}
</style>
