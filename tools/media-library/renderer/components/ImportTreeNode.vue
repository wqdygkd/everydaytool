<script setup lang="ts">
import type { ImportSelection, ScanNode } from '@shared/media-library'
import {
  excludedAncestor,
  includedScanStats,
  rawScanStats,
  selectedAncestor,
  selectedDescendantCount,
} from '@shared/media-library'
import { computed, ref } from 'vue'
import { scanCountsLabel } from '../format'
import MlIcon from './MlIcon.vue'

defineOptions({ name: 'ImportTreeNode' })

const props = defineProps<{
  node: ScanNode
  selection: ImportSelection
  depth?: number
}>()

const emit = defineEmits<{
  toggleCard: [node: ScanNode]
  toggleExclude: [node: ScanNode]
}>()

const collapsed = ref(false)
const depth = computed(() => props.depth ?? 0)
const selected = computed(() => props.selection.selected.has(props.node.path))
const cardAncestor = computed(() => selectedAncestor(props.selection, props.node.path))
const excluded = computed(() => props.selection.excluded.has(props.node.path))
const excludeAncestor = computed(() => excludedAncestor(props.selection, props.node.path))
const descendantCards = computed(() => selectedDescendantCount(props.selection, props.node))
const inherited = computed(() => cardAncestor.value !== null && !excluded.value && excludeAncestor.value === null)
const isExcluded = computed(() => excluded.value || excludeAncestor.value !== null)
const canExclude = computed(() => cardAncestor.value !== null && excludeAncestor.value === null)
const stats = computed(() =>
  (selected.value || cardAncestor.value !== null) && !isExcluded.value
    ? includedScanStats(props.selection, props.node)
    : rawScanStats(props.node),
)
const ancestorName = computed(() => {
  const path = cardAncestor.value
  if (path === null) return ''
  if (!path) return '扫描根目录'
  return path.split('/').at(-1) ?? path
})
const stateLabel = computed(() => {
  if (selected.value) return '卡片'
  if (excluded.value) return '已排除'
  if (excludeAncestor.value !== null) return '随父排除'
  if (descendantCards.value) return `含 ${descendantCards.value} 张`
  if (cardAncestor.value !== null) return `归入 ${ancestorName.value}`
  return ''
})
</script>

<template>
  <div
    class="tree-row"
    :class="{
      'is-card': selected,
      'is-inherited': inherited,
      'is-excluded': isExcluded,
    }"
    :style="`--tree-indent:${6 + depth * 16}px`"
  >
    <button
      v-if="node.children.length"
      type="button"
      class="tree-caret"
      :aria-expanded="!collapsed"
      :aria-label="`${collapsed ? '展开' : '收起'} ${node.name}`"
      @click="collapsed = !collapsed"
    >
      <MlIcon :name="collapsed ? 'chevronRight' : 'chevronDown'" :size="12" />
    </button>
    <span v-else class="tree-caret is-empty" />

    <button
      v-if="cardAncestor === null"
      type="button"
      class="tree-check"
      :class="{ 'is-on': selected, 'is-partial': !selected && descendantCards > 0 }"
      :aria-pressed="selected"
      :aria-label="selected ? `取消 ${node.name} 卡片` : descendantCards ? `将 ${node.name} 合并为一张卡片` : `将 ${node.name} 设为一张卡片`"
      @click="emit('toggleCard', node)"
    >
      <MlIcon v-if="selected" name="check" :size="10" />
      <MlIcon v-else-if="descendantCards" name="minus" :size="10" />
    </button>
    <span v-else class="tree-check is-inherited" aria-hidden="true"><MlIcon name="check" :size="10" /></span>

    <span class="tree-folder"><MlIcon :name="depth === 0 ? 'layers' : 'folder'" :size="14" /></span>
    <span class="tree-name">
      <b>{{ node.name }}</b>
      <small>{{ scanCountsLabel(stats) }}</small>
    </span>
    <span v-if="stateLabel" class="tree-state" :class="{ card: selected, excluded: isExcluded }">{{ stateLabel }}</span>
    <span v-else />
    <button
      v-if="canExclude"
      type="button"
      class="tree-exclude"
      :class="{ 'is-excluded': excluded }"
      @click="emit('toggleExclude', node)"
    >
      {{ excluded ? '恢复' : '排除' }}
    </button>
    <span v-else />
  </div>

  <template v-if="!collapsed">
    <ImportTreeNode
      v-for="child in node.children"
      :key="child.path"
      :node="child"
      :selection="selection"
      :depth="depth + 1"
      @toggle-card="emit('toggleCard', $event)"
      @toggle-exclude="emit('toggleExclude', $event)"
    />
  </template>
</template>
