<script setup lang="ts">
import type { ToolDefinition } from '../types/tool'
import { useToolLauncher } from '../composables/useToolLauncher'

const props = withDefaults(defineProps<{
  activeId?: string | null
  showSettings?: boolean
}>(), {
  activeId: null,
  showSettings: true,
})

const emit = defineEmits<{
  home: []
  search: []
  settings: []
  selectTool: [toolId: string]
}>()

const { pinnedTools, syncPreferencesWithConfigLayer } = useToolLauncher()

function openTool(tool: ToolDefinition) {
  emit('selectTool', tool.id)
}

onMounted(() => {
  void syncPreferencesWithConfigLayer()
})
</script>

<template>
  <aside class="app-rail" aria-label="工具导航">
    <div class="rail-stack">
      <button
        type="button"
        class="rail-brand"
        aria-label="回到工具台"
        data-tooltip="工具台"
        @click="emit('home')"
      >
        edt
      </button>

      <span class="rail-divider" aria-hidden="true" />

      <button
        type="button"
        class="rail-button"
        :class="{ 'is-active': !props.activeId }"
        aria-label="首页"
        data-tooltip="首页"
        :aria-current="!props.activeId ? 'page' : undefined"
        @click="emit('home')"
      >
        <UiIcon name="home" :size="19" />
      </button>

      <button
        v-for="tool in pinnedTools"
        :key="tool.id"
        type="button"
        class="rail-button"
        :class="{ 'is-active': props.activeId === tool.id }"
        :aria-label="tool.name"
        :aria-current="props.activeId === tool.id ? 'page' : undefined"
        :data-tooltip="tool.name"
        @click="openTool(tool)"
      >
        <UiIcon :name="tool.icon" :size="19" />
      </button>
    </div>

    <div class="rail-stack rail-bottom">
      <button
        type="button"
        class="rail-button"
        aria-label="搜索工具（Ctrl K）"
        data-tooltip="搜索工具  Ctrl K"
        @click="emit('search')"
      >
        <UiIcon name="search" :size="18" />
      </button>

      <button
        v-if="showSettings"
        type="button"
        class="rail-button"
        :class="{ 'is-active': props.activeId === 'settings' }"
        aria-label="设置"
        data-tooltip="设置"
        :aria-current="props.activeId === 'settings' ? 'page' : undefined"
        @click="emit('settings')"
      >
        <UiIcon name="gear" :size="18" />
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.app-rail {
  position: relative;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 var(--rail-width);
  width: var(--rail-width);
  min-height: 0;
  padding: 10px 0 12px;
  border-right: 1px solid color-mix(in srgb, var(--color-border-light) 78%, transparent);
  background: var(--color-rail);
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--color-on-solid) 58%, transparent);
  -webkit-app-region: drag;
}

.rail-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  width: 100%;
}

.rail-bottom {
  margin-top: auto;
}

.rail-brand,
.rail-button {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: var(--rail-control-size);
  height: var(--rail-control-size);
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;
  -webkit-app-region: no-drag;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);

  &::after {
    position: absolute;
    left: calc(100% + 8px);
    z-index: 100;
    padding: 5px 8px;
    border: 1px solid color-mix(in srgb, var(--color-on-solid) 12%, transparent);
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, #0e1721 94%, transparent);
    color: #f2f7fc;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    line-height: 1.3;
    white-space: nowrap;
    content: attr(data-tooltip);
    opacity: 0;
    pointer-events: none;
    transform: translateX(-3px);
    transition:
      opacity var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  &:hover {
    background: color-mix(in srgb, var(--color-on-solid) 46%, transparent);
    color: var(--color-text-primary);
  }

  &:hover::after {
    opacity: 1;
    transform: translateX(0);
    transition-delay: 180ms;
  }

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  &:active {
    transform: scale(0.97);
  }
}

.rail-brand {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-family: var(--font-brand);
  font-size: 12px;
  font-weight: var(--font-weight-brand);
  letter-spacing: 0.05em;

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary-strong);
  }
}

.rail-button {
  &.is-active {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);

    &::before {
      position: absolute;
      left: -13px;
      width: 3px;
      height: 18px;
      border-radius: 0 3px 3px 0;
      background: var(--color-primary);
      content: '';
      animation: rail-indicator-in var(--duration-fast) var(--ease-out);
    }
  }
}

.rail-divider {
  width: 28px;
  height: 1px;
  margin: 1px 0 2px;
  background: var(--color-border-light);
}

@keyframes rail-indicator-in {
  from {
    opacity: 0;
    transform: scaleY(0.35);
  }

  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

:global(.platform-darwin) .app-rail {
  padding-top: 46px;
}

@media (prefers-reduced-motion: reduce) {
  .rail-button.is-active::before {
    animation: none;
  }
}
</style>
