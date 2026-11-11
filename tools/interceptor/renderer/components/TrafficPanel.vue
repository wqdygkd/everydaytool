<script setup lang="ts">
import type { TrafficEntry } from '../../../../shared/interceptor'
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { confirm } from '@renderer/shared/feedback'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { useInterceptorStore } from '../stores/interceptorStore'

const emit = defineEmits<{ createRule: [entry: TrafficEntry] }>()

const store = useInterceptorStore()
const paneActive = useToolPaneActive()

const filter = ref('')
const detail = ref<TrafficEntry | null>(null)
const detailVisible = ref(false)

const filteredTraffic = computed(() => {
  const keyword = filter.value.trim().toLowerCase()
  const list = keyword
    ? store.traffic.filter(entry => entry.url.toLowerCase().includes(keyword))
    : store.traffic
  return [...list].reverse()
})

function statusTagType(status?: number): 'success' | 'info' | 'warning' | 'danger' {
  if (!status) return 'danger'
  if (status < 300) return 'success'
  if (status < 400) return 'info'
  if (status < 500) return 'warning'
  return 'danger'
}

function formatTime(at: number): string {
  const date = new Date(at)
  return `${date.toLocaleTimeString()}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

/** UiTableColumn 插槽给的 row 是宽泛记录类型，这里收窄为流量条目类型。 */
function entryOf(row: unknown): TrafficEntry {
  return row as TrafficEntry
}

function openDetail(entry: TrafficEntry): void {
  detail.value = entry
  detailVisible.value = true
}

function createRule(entry: TrafficEntry): void {
  store.openRuleEditorFromTraffic(entry)
  detailVisible.value = false
  emit('createRule', entry)
}

async function clearAll(): Promise<void> {
  try {
    await confirm('确认清空当前流量记录？', '清空确认', { type: 'warning' })
  } catch {
    return
  }
  await store.clearTraffic()
}

function headersText(headers?: Record<string, string>): string {
  if (!headers) return ''
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n')
}
</script>

<template>
  <div class="traffic-pane">
    <Teleport v-if="paneActive" defer to="#interceptor-toolbar">
      <header class="traffic-toolbar is-toolbar">
        <UiSearchInput
          v-model="filter"
          variant="box"
          placeholder="按 URL 过滤"
          clearable
          class="traffic-search"
        />
        <span class="traffic-count">{{ filteredTraffic.length }} / {{ store.traffic.length }} 条</span>
        <span class="toolbar-spacer" />
        <UiButton size="small" :disabled="!store.traffic.length" @click="clearAll">
          清空
        </UiButton>
      </header>
    </Teleport>

    <UiTable
      class="traffic-table"
      :data="filteredTraffic"
      height="100%"
      empty-text="暂无流量：只有命中处理名单的请求才会记录（未命中按透传处理）。先确认目标 origin 已在名单里、且浏览器已挂上代理"
      row-clickable
      @row-click="openDetail"
    >
      <UiTableColumn label="时间" width="110">
        <template #default="{ row }">
          <span class="mono muted">{{ formatTime(row.at) }}</span>
        </template>
      </UiTableColumn>
      <UiTableColumn label="方法" width="80">
        <template #default="{ row }">
          <span class="mono">{{ row.method }}</span>
        </template>
      </UiTableColumn>
      <UiTableColumn label="URL" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono url-cell">{{ row.host }}{{ row.path }}</span>
        </template>
      </UiTableColumn>
      <UiTableColumn label="状态" width="90">
        <template #default="{ row }">
          <UiChip v-if="row.error" tone="danger" variant="soft">
            ERR
          </UiChip>
          <UiChip v-else :tone="statusTagType(row.status)" variant="soft">
            {{ row.status ?? '—' }}
          </UiChip>
        </template>
      </UiTableColumn>
      <UiTableColumn label="耗时" width="90">
        <template #default="{ row }">
          <span class="mono muted">{{ row.durationMs != null ? `${row.durationMs}ms` : '—' }}</span>
        </template>
      </UiTableColumn>
      <UiTableColumn label="标记" min-width="180">
        <template #default="{ row }">
          <UiGroup wrap gap="sm">
            <UiChip v-if="row.canceled" tone="danger" variant="soft">
              取消
            </UiChip>
            <UiChip v-if="row.mocked" tone="warning" variant="soft">
              Mock
            </UiChip>
            <UiChip v-if="row.redirectedTo" tone="info" variant="soft">
              重定向
            </UiChip>
            <UiChip v-if="row.delayedByMs" tone="warning" variant="outline">
              +{{ row.delayedByMs }}ms
            </UiChip>
            <UiChip v-for="name in row.matchedRuleNames ?? []" :key="name" tone="info" variant="outline">
              {{ name }}
            </UiChip>
          </UiGroup>
        </template>
      </UiTableColumn>
      <UiTableColumn width="120" align="right">
        <template #default="{ row }">
          <UiButton size="small" text type="primary" @click.stop="createRule(entryOf(row))">
            建规则
          </UiButton>
        </template>
      </UiTableColumn>
    </UiTable>
    <footer class="traffic-footnote">
      <span>只记录命中处理名单的请求；内存保留最近 1000 条，body 超 64KB 截断。</span>
      <span class="mono">data: / blob: / chrome-extension: 不走代理</span>
    </footer>
  </div>

  <UiDialog v-model="detailVisible" title="流量详情" width="min(860px, 94vw)" destroy-on-close>
    <UiGroup v-if="detail" direction="column" gap="sm">
      <UiGroup wrap gap="sm">
        <UiChip variant="outline">
          {{ detail.method }}
        </UiChip>
        <UiChip v-if="detail.status" :tone="statusTagType(detail.status)" variant="soft">
          {{ detail.status }}
        </UiChip>
        <UiChip v-if="detail.canceled" tone="danger" variant="soft">
          取消
        </UiChip>
        <UiChip v-if="detail.mocked" tone="warning" variant="soft">
          Mock 短路
        </UiChip>
        <UiChip v-if="detail.redirectedTo" tone="info" variant="soft">
          重定向
        </UiChip>
        <UiChip v-if="detail.delayedByMs" tone="warning" variant="soft">
          延迟 {{ detail.delayedByMs }}ms
        </UiChip>
        <UiChip v-for="name in detail.matchedRuleNames ?? []" :key="name" tone="info" variant="soft">
          {{ name }}
        </UiChip>
        <span class="mono muted">{{ detail.durationMs != null ? `${detail.durationMs}ms` : '' }}</span>
      </UiGroup>
      <div class="detail-url mono">
        {{ detail.url }}
      </div>
      <div v-if="detail.redirectedTo" class="detail-url mono muted">
        ↳ 重定向到 {{ detail.redirectedTo }}
      </div>
      <div v-if="detail.rewrittenTo" class="detail-url mono muted">
        ↳ 实际请求 {{ detail.rewrittenTo }}
      </div>
      <div v-if="detail.error" class="error-line">
        {{ detail.error }}
      </div>

      <UiDetailGrid>
        <UiPanel variant="outlined" title="请求头">
          <template #actions>
            <UiButton size="small" text type="primary" @click="useCopy(headersText(detail.requestHeaders), '请求头')">
              复制
            </UiButton>
          </template>
          <UiCodeBlock wrap>
            {{ headersText(detail.requestHeaders) || '—' }}
          </UiCodeBlock>
        </UiPanel>
        <UiPanel variant="outlined" title="响应头">
          <template #actions>
            <UiButton size="small" text type="primary" @click="useCopy(headersText(detail.responseHeaders), '响应头')">
              复制
            </UiButton>
          </template>
          <UiCodeBlock wrap>
            {{ headersText(detail.responseHeaders) || '—' }}
          </UiCodeBlock>
        </UiPanel>
      </UiDetailGrid>

      <div v-if="detail.requestBody" class="body-section">
        <div class="detail-item-title">
          请求体
          <UiButton size="small" text type="primary" @click="useCopy(detail.requestBody, '请求体')">
            复制
          </UiButton>
        </div>
        <UiCodeBlock wrap max-height="260px">
          {{ detail.requestBody }}
        </UiCodeBlock>
      </div>
      <div v-if="detail.responseBody" class="body-section">
        <div class="detail-item-title">
          响应体
          <UiButton size="small" text type="primary" @click="useCopy(detail.responseBody, '响应体')">
            复制
          </UiButton>
        </div>
        <UiCodeBlock wrap max-height="260px">
          {{ detail.responseBody }}
        </UiCodeBlock>
      </div>
      <UiHint v-if="detail.bodyTruncated" block>
        body 显示为截断内容（上限 64KB）。
      </UiHint>
    </UiGroup>

    <template #footer>
      <UiButton @click="detailVisible = false">
        关闭
      </UiButton>
      <UiButton v-if="detail" type="primary" @click="createRule(detail)">
        以此建规则
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.traffic-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.traffic-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 48px;
  height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.traffic-toolbar.is-toolbar {
  flex: 1;
  height: 100%;
  padding: 0;
  border-bottom: 0;
}

.traffic-search {
  width: 280px;
}

.traffic-count {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.toolbar-spacer {
  flex: 1;
}

.traffic-table {
  flex: 1;
  min-height: 0;
}

.traffic-table :deep(.ui-table-wrap) {
  height: 100%;
  border-radius: 0;
}

.traffic-footnote {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  flex: 0 0 31px;
  height: 31px;
  padding: 0 14px;
  border-top: 1px solid var(--color-border-light);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);

  .mono {
    margin-left: auto;
    white-space: nowrap;
  }
}

.url-cell {
  font-size: var(--font-size-sm);
}

.detail-url {
  font-size: var(--font-size-sm);
  word-break: break-all;
}

.error-line {
  color: var(--color-error);
}

.detail-item-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.body-section {
  margin-top: var(--spacing-xs);
}
</style>
