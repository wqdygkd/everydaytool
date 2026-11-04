<script setup lang="ts">
import type { OpenTool } from '../../stores/toolTabs'
import type { IconName } from './ui/icons'
import { useToolLauncher } from '../composables/useToolLauncher'

const props = withDefaults(defineProps<{
  activeId?: string | null
  /** 已打开的工具（toolTabs store），按打开顺序 */
  openTools?: OpenTool[]
  showSettings?: boolean
}>(), {
  activeId: null,
  openTools: () => [],
  showSettings: true,
})

const emit = defineEmits<{
  home: []
  search: []
  settings: []
  selectTool: [toolId: string]
  close: [toolId: string]
}>()

const { pinnedTools, syncPreferencesWithConfigLayer } = useToolLauncher()

interface RailTool {
  id: string
  name: string
  icon: IconName
  /** 置顶项：关闭只停止运行，图标留在 rail（Dock 语义）；非置顶项关闭即从列表消失 */
  pinned: boolean
  /** 此刻是否「打开中」（决定运行圆点与关闭钮） */
  open: boolean
}

/**
 * 左轨 = 首页 → 置顶（常驻、位置稳定）→ 已打开的非置顶工具（按打开顺序追加）。
 * 同一个工具只会出现一次，永远取置顶那一位。
 */
const railTools = computed<RailTool[]>(() => {
  const openIds = new Set(props.openTools.map(tool => tool.id))
  const pinned = pinnedTools.value.map<RailTool>(tool => ({
    id: tool.id,
    name: tool.name,
    icon: tool.icon,
    pinned: true,
    open: openIds.has(tool.id),
  }))
  const pinnedIds = new Set(pinned.map(tool => tool.id))
  const transient = props.openTools
    .filter(tool => !pinnedIds.has(tool.id))
    .map<RailTool>(tool => ({
      id: tool.id,
      name: tool.name,
      icon: tool.icon,
      pinned: false,
      open: true,
    }))
  return [...pinned, ...transient]
})

function closeLabel(tool: RailTool): string {
  // 置顶项的关闭语义是「停止运行」而不是「删掉入口」，文案必须说清楚，避免误以为把图标删了
  return tool.pinned ? `关闭 ${tool.name}（保留置顶）` : `关闭 ${tool.name}`
}

onMounted(() => {
  void syncPreferencesWithConfigLayer()
})
</script>

<template>
  <aside class="app-rail" aria-label="工具导航">
    <div class="rail-scroll">
      <UiTooltip text="首页">
        <button
          type="button"
          class="rail-button"
          :class="{ 'is-active': !props.activeId }"
          aria-label="首页"
          :aria-current="!props.activeId ? 'page' : undefined"
          @click="emit('home')"
        >
          <UiIcon name="home" :size="19" />
        </button>
      </UiTooltip>

      <span class="rail-divider" aria-hidden="true" />

      <div v-for="tool in railTools" :key="tool.id" class="rail-item">
        <UiTooltip :text="tool.name">
          <button
            type="button"
            class="rail-button"
            :class="{ 'is-active': props.activeId === tool.id }"
            :aria-label="tool.name"
            :aria-current="props.activeId === tool.id ? 'page' : undefined"
            @click="emit('selectTool', tool.id)"
          >
            <UiIcon :name="tool.icon" :size="19" />
            <span v-if="tool.open && props.activeId !== tool.id" class="rail-run-dot" aria-hidden="true" />
          </button>
        </UiTooltip>

        <UiTooltip v-if="tool.open" :text="closeLabel(tool)">
          <button
            type="button"
            class="rail-close"
            :aria-label="closeLabel(tool)"
            @click.stop="emit('close', tool.id)"
          >
            <UiIcon name="close" :size="9" />
          </button>
        </UiTooltip>
      </div>
    </div>

    <div class="rail-stack rail-bottom">
      <UiTooltip text="搜索工具  Ctrl K">
        <button
          type="button"
          class="rail-button"
          aria-label="搜索工具（Ctrl K）"
          @click="emit('search')"
        >
          <UiIcon name="search" :size="18" />
        </button>
      </UiTooltip>

      <UiTooltip v-if="props.showSettings" text="设置">
        <button
          type="button"
          class="rail-button"
          :class="{ 'is-active': props.activeId === 'settings' }"
          aria-label="设置"
          :aria-current="props.activeId === 'settings' ? 'page' : undefined"
          @click="emit('settings')"
        >
          <UiIcon name="gear" :size="18" />
        </button>
      </UiTooltip>
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
  background: var(--color-rail);
  -webkit-app-region: drag;
}

/* 右缘分隔线 + 内侧 1px 高光：画成伪元素而不是 border-right / inset 阴影，
   这样分隔线可以有自己的起止（当前整列从标题栏下沿开始，起止就是 rail 自身）。 */
.app-rail::before,
.app-rail::after {
  position: absolute;
  top: 0;
  bottom: 0;
  content: '';
  pointer-events: none;
}

.app-rail::before {
  right: 1px;
  width: 1px;
  background: color-mix(in srgb, var(--color-on-solid) 58%, transparent);
}

.app-rail::after {
  right: 0;
  width: 1px;
  background: color-mix(in srgb, var(--color-border-light) 78%, transparent);
}

/* 运行列表区：工具多到一列放不下时只滚这里，首页与底部搜索 / 设置始终可见。
   注意 overflow 会裁掉旧的 ::after tooltip，因此提示层换成了 portal 到 body 的 UiTooltip。 */
.rail-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 0;
  padding-bottom: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.rail-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  width: 100%;
}

.rail-bottom {
  flex: none;
}

.rail-item {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 100%;
}

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

  &:hover {
    background: color-mix(in srgb, var(--color-on-solid) 46%, transparent);
    color: var(--color-text-primary);
  }

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

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  &:active {
    transform: scale(0.97);
  }
}

/* 运行中圆点：只在「已打开但未激活」时出现；激活态已有浅底 + 左侧指示条，不再重复标记 */
.rail-run-dot {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-primary);
  pointer-events: none;
}

/* 关闭钮：悬停 / 键盘聚焦才显现，避免 42px 图标长期被小叉遮住 */
.rail-close {
  position: absolute;
  top: 0;
  right: 3px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-raised);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  opacity: 0;
  outline: none;
  transform: scale(0.9);
  -webkit-app-region: no-drag;
  transition:
    opacity var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);

  &:hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    opacity: 1;
    box-shadow: var(--shadow-focus);
  }
}

.rail-item:hover .rail-close,
.rail-item:focus-within .rail-close {
  opacity: 1;
  transform: none;
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

@media (prefers-reduced-motion: reduce) {
  .rail-button.is-active::before {
    animation: none;
  }
}
</style>
