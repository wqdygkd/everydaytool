<script setup lang="ts">
import type { TrafficEntry } from '../../../../shared/browser-bridge'
import { useBrowserBridgeStore } from '../stores/browserBridgeStore'

const emit = defineEmits<{ createRule: [entry: TrafficEntry] }>()

const store = useBrowserBridgeStore()

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

function openDetail(entry: TrafficEntry): void {
  detail.value = entry
  detailVisible.value = true
}

function createRule(entry: TrafficEntry): void {
  store.openRuleEditorFromTraffic(entry)
  detailVisible.value = false
  emit('createRule', entry)
}

async function copyText(text: string | undefined, label: string): Promise<void> {
  if (!text) {
    ElMessage.warning(`${label}为空`)
    return
  }
  await navigator.clipboard.writeText(text)
  ElMessage.success(`${label}已复制`)
}

async function clearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空当前流量记录？', '清空确认', { type: 'warning' })
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
  <div class="surface-card panel">
    <div class="panel-head">
      <span class="panel-title">
        流量
        <span class="chip mono">{{ store.traffic.length }}</span>
      </span>
      <div class="inline-group">
        <el-input v-model="filter" placeholder="按 URL 过滤" clearable style="width: 240px" size="small" />
        <el-button size="small" :disabled="!store.traffic.length" @click="clearAll">
          清空
        </el-button>
      </div>
    </div>
    <p class="form-hint intro">
      只记录处理名单命中的请求（含规则改写 / Mock 短路）；内存保留最近 1000 条，body 超 64KB 截断。
    </p>

    <el-table
      :data="filteredTraffic"
      size="small"
      height="460"
      empty-text="暂无流量（先在扩展弹窗把目标站点加入名单，再让页面发请求）"
      @row-click="openDetail"
    >
      <el-table-column label="时间" width="110">
        <template #default="{ row }">
          <span class="mono muted">{{ formatTime(row.at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="方法" width="80">
        <template #default="{ row }">
          <span class="mono">{{ row.method }}</span>
        </template>
      </el-table-column>
      <el-table-column label="URL" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono url-cell">{{ row.host }}{{ row.path }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.error" size="small" type="danger">
            ERR
          </el-tag>
          <el-tag v-else size="small" :type="statusTagType(row.status)">
            {{ row.status ?? '—' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="90">
        <template #default="{ row }">
          <span class="mono muted">{{ row.durationMs != null ? `${row.durationMs}ms` : '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="标记" min-width="180">
        <template #default="{ row }">
          <div class="inline-group wrap">
            <el-tag v-if="row.canceled" size="small" type="danger">
              取消
            </el-tag>
            <el-tag v-if="row.mocked" size="small" type="warning">
              Mock
            </el-tag>
            <el-tag v-if="row.redirectedTo" size="small" type="info">
              重定向
            </el-tag>
            <el-tag v-if="row.delayedByMs" size="small" type="warning" effect="plain">
              +{{ row.delayedByMs }}ms
            </el-tag>
            <el-tag v-for="name in row.matchedRuleNames ?? []" :key="name" size="small" type="info" effect="plain">
              {{ name }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column width="120" align="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click.stop="createRule(row)">
            建规则
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <el-dialog v-model="detailVisible" title="流量详情" width="min(860px, 94vw)" append-to-body destroy-on-close>
    <div v-if="detail" class="detail">
      <div class="inline-group detail-meta">
        <el-tag size="small">
          {{ detail.method }}
        </el-tag>
        <el-tag v-if="detail.status" size="small" :type="statusTagType(detail.status)">
          {{ detail.status }}
        </el-tag>
        <el-tag v-if="detail.canceled" size="small" type="danger">
          取消
        </el-tag>
        <el-tag v-if="detail.mocked" size="small" type="warning">
          Mock 短路
        </el-tag>
        <el-tag v-if="detail.redirectedTo" size="small" type="info">
          重定向
        </el-tag>
        <el-tag v-if="detail.delayedByMs" size="small" type="warning">
          延迟 {{ detail.delayedByMs }}ms
        </el-tag>
        <el-tag v-for="name in detail.matchedRuleNames ?? []" :key="name" size="small" type="info">
          {{ name }}
        </el-tag>
        <span class="mono muted">{{ detail.durationMs != null ? `${detail.durationMs}ms` : '' }}</span>
      </div>
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

      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-title">
            请求头
            <el-button size="small" text type="primary" @click="copyText(headersText(detail.requestHeaders), '请求头')">
              复制
            </el-button>
          </div>
          <pre class="mono body-block">{{ headersText(detail.requestHeaders) || '—' }}</pre>
        </div>
        <div class="detail-item">
          <div class="detail-item-title">
            响应头
            <el-button size="small" text type="primary" @click="copyText(headersText(detail.responseHeaders), '响应头')">
              复制
            </el-button>
          </div>
          <pre class="mono body-block">{{ headersText(detail.responseHeaders) || '—' }}</pre>
        </div>
      </div>

      <div v-if="detail.requestBody" class="body-section">
        <div class="detail-item-title">
          请求体
          <el-button size="small" text type="primary" @click="copyText(detail.requestBody, '请求体')">
            复制
          </el-button>
        </div>
        <pre class="mono body-block tall">{{ detail.requestBody }}</pre>
      </div>
      <div v-if="detail.responseBody" class="body-section">
        <div class="detail-item-title">
          响应体
          <el-button size="small" text type="primary" @click="copyText(detail.responseBody, '响应体')">
            复制
          </el-button>
        </div>
        <pre class="mono body-block tall">{{ detail.responseBody }}</pre>
      </div>
      <p v-if="detail.bodyTruncated" class="form-hint">
        body 显示为截断内容（上限 64KB）。
      </p>
    </div>

    <template #footer>
      <el-button @click="detailVisible = false">
        关闭
      </el-button>
      <el-button v-if="detail" type="primary" @click="createRule(detail)">
        以此建规则
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-weight: var(--font-weight-semibold);
}

.intro {
  margin-top: 0;
}

.url-cell {
  font-size: var(--font-size-sm);
}

:deep(.el-table__row) {
  cursor: pointer;
}

.detail {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.detail-meta {
  flex-wrap: wrap;
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

.body-block {
  max-height: 200px;
  padding: var(--spacing-sm);
  margin: 0;
  overflow: auto;
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--color-app-bg);
  border-radius: var(--radius-sm);
}

.body-block.tall {
  max-height: 260px;
}

.body-section {
  margin-top: var(--spacing-xs);
}

.wrap {
  flex-wrap: wrap;
}
</style>
