<script setup lang="ts">
import type { PlanAction, PlanItem, UpdatePlan } from '@shared/skill-manager'

const props = defineProps<{
  plan: UpdatePlan
  selected: string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  toggle: [name: string]
}>()

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

const ACTION_META: Record<PlanAction, { label: string, tone: Tone, executable: boolean }> = {
  update: { label: '更新', tone: 'warning', executable: true },
  move: { label: '移动', tone: 'warning', executable: true },
  reinstall: { label: '重装', tone: 'warning', executable: true },
  remove: { label: '移除', tone: 'danger', executable: true },
  add: { label: '未安装', tone: 'neutral', executable: false },
  install: { label: '未安装', tone: 'neutral', executable: false },
  conflict: { label: '冲突', tone: 'danger', executable: false },
  ambiguous: { label: '同名歧义', tone: 'danger', executable: false },
  unknown: { label: '无法判定', tone: 'neutral', executable: false },
  skip: { label: '无变化', tone: 'neutral', executable: false },
}

const ORDER: PlanAction[] = ['update', 'move', 'reinstall', 'remove', 'add', 'install', 'conflict', 'ambiguous', 'unknown', 'skip']

const orderedItems = computed(() => {
  return [...props.plan.items].sort((left, right) => {
    const order = ORDER.indexOf(left.action) - ORDER.indexOf(right.action)
    return order || left.name.localeCompare(right.name)
  })
})

const summaryChips = computed(() => {
  return ORDER
    .filter(action => props.plan.summary[action] > 0)
    .map(action => ({ action, ...ACTION_META[action], count: props.plan.summary[action] }))
})

function isExecutable(item: PlanItem): boolean {
  return ACTION_META[item.action].executable
}

function toggle(item: PlanItem): void {
  if (!isExecutable(item) || props.disabled) return
  emit('toggle', item.name)
}

function pathLabel(item: PlanItem): string {
  if (item.fromPath && item.toPath && item.fromPath !== item.toPath) return `${item.fromPath} → ${item.toPath}`
  return item.toPath || item.fromPath || ''
}
</script>

<template>
  <section class="plan-panel" aria-label="更新计划">
    <div class="plan-meta">
      <span class="plan-ref">ref <b>{{ plan.resolvedRef }}</b></span>
      <span v-if="plan.commitSha" class="plan-commit">{{ plan.commitSha.slice(0, 12) }}</span>
      <span class="plan-time">{{ new Date(plan.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
    </div>

    <div class="plan-summary">
      <UiChip
        v-for="chip in summaryChips"
        :key="chip.action"
        :tone="chip.tone"
      >
        {{ chip.label }} {{ chip.count }}
      </UiChip>
      <span v-if="!summaryChips.length" class="plan-clean">远端与本地一致</span>
    </div>

    <p v-for="warning in plan.warnings" :key="warning" class="plan-warning">
      {{ warning }}
    </p>

    <div v-if="orderedItems.length" class="plan-list" role="group" aria-label="计划条目">
      <label
        v-for="item in orderedItems"
        :key="`${item.action}:${item.name}`"
        class="plan-row"
        :class="{
          'is-static': !isExecutable(item),
          'is-selected': selected.includes(item.name),
          'is-modified': item.localModified,
        }"
      >
        <input
          v-if="isExecutable(item)"
          type="checkbox"
          :checked="selected.includes(item.name)"
          :disabled="disabled"
          @change="toggle(item)"
        >
        <span v-else class="plan-mark" aria-hidden="true" />
        <UiStatusTag :tone="ACTION_META[item.action].tone" />
        <span class="plan-name">{{ item.name }}</span>
        <span v-if="item.localModified" class="plan-mod">本地已修改</span>
        <span class="plan-path" :title="pathLabel(item)">{{ pathLabel(item) }}</span>
        <span class="plan-reason">{{ item.reasons.join(' · ') }}</span>
      </label>
    </div>
    <p v-else class="plan-empty">
      该仓库没有可比较的技能。
    </p>

    <p class="plan-footnote">
      只执行勾选项；未勾选与「未安装 / 冲突 / 无法判定」均不会改动。
    </p>
  </section>
</template>

<style scoped lang="scss">
.plan-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.plan-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.plan-ref b {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-weight: var(--font-weight-medium);
}

.plan-commit,
.plan-time {
  padding-left: 8px;
  border-left: 1px solid var(--color-border-light);
  font-family: var(--font-mono);
  font-size: 11px;
}

.plan-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.plan-clean {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.plan-warning {
  margin: 0;
  padding: 7px 9px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-warning) 9%, transparent);
  color: var(--color-warning);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.plan-list {
  display: grid;
  gap: 2px;
  max-height: 360px;
  padding: 3px;
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: 9px;
  background: var(--color-well);
}

.plan-row {
  display: grid;
  grid-template-columns: 16px auto minmax(90px, 1fr) auto;
  grid-template-areas:
    'check action name mod'
    'check action path reason';
  align-items: center;
  gap: 2px 7px;
  padding: 7px 8px;
  border-radius: 7px;
  cursor: pointer;

  input {
    grid-area: check;
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: var(--color-primary);
  }

  > :deep(.ui-status-tag) { grid-area: action; }
  &:hover { background: var(--color-fill); }
  &.is-selected { background: var(--color-primary-soft); }
  &.is-static { cursor: default; opacity: .78; }
}

.plan-mark {
  grid-area: check;
  width: 13px;
}

.plan-name {
  grid-area: name;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-mod {
  grid-area: mod;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--color-warning) 11%, transparent);
  color: var(--color-warning);
  font-size: 10px;
  white-space: nowrap;
}

.plan-path,
.plan-reason {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-path { grid-area: path; }
.plan-reason { grid-area: reason; font-family: inherit; }

.plan-empty,
.plan-footnote {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.plan-footnote {
  padding-top: 1px;
}
</style>
