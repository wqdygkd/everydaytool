<script lang="ts">
// 媒体库专用图标集（24 网格、1.7 线宽，与预览稿一致）。
// 平台的 UiIcon 没有胶片 / 文件夹 / 盾牌 / 播放器控件这类图形，这里收在工具内，不污染全局图标表。
interface IconShape {
  body: string
  fill?: boolean
}

const ICONS = {
  play: { body: '<path d="M8 5v14l11-7z"/>', fill: true },
  pause: { body: '<rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/>', fill: true },
  film: { body: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>' },
  image: { body: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 21"/>' },
  layers: { body: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>' },
  search: { body: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>' },
  close: { body: '<path d="M6 6l12 12M18 6 6 18"/>' },
  chevronDown: { body: '<path d="m6 9 6 6 6-6"/>' },
  chevronRight: { body: '<path d="m9 6 6 6-6 6"/>' },
  chevronLeft: { body: '<path d="m15 6-6 6 6 6"/>' },
  arrowLeft: { body: '<path d="M19 12H5M11 18l-6-6 6-6"/>' },
  arrowRight: { body: '<path d="M5 12h14M13 6l6 6-6 6"/>' },
  plus: { body: '<path d="M12 5v14M5 12h14"/>' },
  minus: { body: '<path d="M5 12h14"/>' },
  refresh: { body: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>' },
  edit: { body: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 6.5 3 3"/>' },
  check: { body: '<path d="m5 12 4 4L19 6"/>' },
  shield: { body: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>' },
  folder: { body: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>' },
  folderPlus: { body: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v6M9 14h6"/>' },
  grid: { body: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  list: { body: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
  more: { body: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', fill: true },
  volume: { body: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M17 9.5a4 4 0 0 1 0 5M19.5 7a8 8 0 0 1 0 10"/>' },
  volumeOff: { body: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9.5 4.5 5M21.5 9.5l-4.5 5"/>' },
  fullscreen: { body: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>' },
  fullscreenExit: { body: '<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>' },
  gauge: { body: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 3.5-4.5"/><circle cx="12" cy="13" r="1.2"/>' },
  trash: { body: '<path d="M4 7h16M9 3h6l1 4H8l1-4ZM6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>' },
  copy: { body: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' },
  external: { body: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>' },
  info: { body: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>' },
  warning: { body: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>' },
  clock: { body: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  sliders: { body: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>' },
} satisfies Record<string, IconShape>

export type MlIconName = keyof typeof ICONS
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  name: MlIconName
  size?: number
}>(), {
  size: 16,
})

const shape = computed<IconShape>(() => ICONS[props.name] ?? ICONS.info)
</script>

<template>
  <!-- body 是本文件内的静态常量（不含任何用户输入），可以安全地用 v-html 注入 -->
  <!-- eslint-disable vue/no-v-html -->
  <svg
    class="ic"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="shape.fill ? 'currentColor' : 'none'"
    :stroke="shape.fill ? 'none' : 'currentColor'"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="shape.body"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
