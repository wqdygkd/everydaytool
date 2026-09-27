<script setup lang="ts">
import type { ShellMenuAction } from '../../../shared/types'

interface MenuItem {
  label: string
  action: ShellMenuAction
  accel?: string
  divided?: boolean
}

interface MenuGroup {
  label: string
  items: MenuItem[]
}

const MENUS: MenuGroup[] = [
  {
    label: '文件',
    items: [
      { label: '退出', action: 'quit' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', action: 'undo', accel: 'Ctrl+Z' },
      { label: '重做', action: 'redo', accel: 'Ctrl+Y' },
      { label: '剪切', action: 'cut', accel: 'Ctrl+X', divided: true },
      { label: '复制', action: 'copy', accel: 'Ctrl+C' },
      { label: '粘贴', action: 'paste', accel: 'Ctrl+V' },
      { label: '全选', action: 'selectAll', accel: 'Ctrl+A' },
    ],
  },
  {
    label: '视图',
    items: [
      { label: '重新加载', action: 'reload', accel: 'Ctrl+R' },
      { label: '强制重新加载', action: 'reloadIgnoringCache', accel: 'Ctrl+Shift+R' },
      { label: '开发者工具', action: 'toggleDevTools', accel: 'F12', divided: true },
      { label: '放大', action: 'zoomIn', accel: 'Ctrl+=' },
      { label: '缩小', action: 'zoomOut', accel: 'Ctrl+-' },
      { label: '重置缩放', action: 'zoomReset', accel: 'Ctrl+0' },
    ],
  },
  {
    label: '窗口',
    items: [
      { label: '最小化', action: 'minimize' },
      { label: '关闭窗口', action: 'close', divided: true },
    ],
  },
]

function runMenuAction(action: ShellMenuAction) {
  window.edtRuntime?.menuAction(action)
}

// macOS 用系统顶部菜单栏（隐藏标题栏的 inset 区不放菜单）；无桥接的纯浏览器环境同样隐藏
const visible = window.edtRuntime != null && window.edtRuntime.platform !== 'darwin'
</script>

<template>
  <nav v-if="visible" class="app-menu" aria-label="应用菜单">
    <el-dropdown
      v-for="menu in MENUS"
      :key="menu.label"
      trigger="click"
      popper-class="app-menu-popper"
      @command="runMenuAction"
    >
      <button type="button" class="app-menu-trigger">
        {{ menu.label }}
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="item in menu.items"
            :key="item.action"
            :command="item.action"
            :divided="item.divided"
          >
            <span class="app-menu-item-label">{{ item.label }}</span>
            <span v-if="item.accel" class="app-menu-item-accel mono">{{ item.accel }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </nav>
</template>

<style scoped lang="scss">
.app-menu {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  // 位于标题栏拖拽区内，必须排除拖拽才能响应点击
  -webkit-app-region: no-drag;
}

.app-menu-trigger {
  padding: 5px 9px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  line-height: 1;
  cursor: pointer;
  transition: var(--transition-fast);

  &:hover,
  &:focus-visible {
    background: var(--color-muted);
    color: var(--color-text-primary);
    outline: none;
  }
}
</style>

<style lang="scss">
/* 弹层 teleport 到 body，需全局样式；颜色走 Element Plus 绑定的语义令牌，双主题自动适配 */
.app-menu-popper {
  min-width: 208px;
}

.app-menu-popper .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 6px 12px;
}

.app-menu-popper .app-menu-item-accel {
  margin-left: auto;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
</style>
