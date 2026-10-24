<script setup lang="ts">
import type { TrafficEntry } from '../../../shared/interceptor'
import { useCopy } from '../../../src/shared/composables/useClipboard'
import { useInterceptorStore } from '../stores/interceptorStore'

const emit = defineEmits<{ createRule: [entry: TrafficEntry] }>()

const store = useInterceptorStore()

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
  <UiPanel>
    <template #title>
      <UiGroup gap="xs">
        <span>流量</span>
        <UiChip mono>
          {{ store.traffic.length }}
        </UiChip>
      </UiGroup>
    </template>
    <template #actions>
      <UiGroup gap="sm">
        <el-input v-model="filter" class="ctl-md" placeholder="按 URL 过滤" clearable size="small" />
        <el-button size="small" :disabled="!store.traffic.length" @click="clearAll">
          清空
        </el-button>
      </UiGroup>
    </template>
    <UiHint>
      只记录处理名单命中的请求（含规则改写 / Mock 短路）；内存保留最近 1000 条，body 超 64KB 截断。
      「强制回源」是<strong>处理名单里每条自己的开关</strong>（默认开）：开了的 origin 响应会去掉缓存头，重复访问也会真的发请求；关掉则回到正常缓存。
      条数仍可能比浏览器控制台少：<span class="mono">data:</span> / <span class="mono">blob:</span> /
      <span class="mono">chrome-extension:</span> 不走代理，其它 origin 不在名单里也不记录。
    </UiHint>

    <el-table
      :data="filteredTraffic"
      size="small"
      height="460"
      empty-text="暂无流量：只有命中处理名单的请求才会记录（未命中按透传处理）。先确认目标 origin 已在名单里、且浏览器已挂上代理"
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
          <UiGroup wrap gap="sm">
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
          </UiGroup>
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
  </UiPanel>

  <UiDialog v-model="detailVisible" title="流量详情" width="min(860px, 94vw)" destroy-on-close>
    <UiGroup v-if="detail" direction="column" gap="sm">
      <UiGroup wrap gap="sm">
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
            <el-button size="small" text type="primary" @click="useCopy(headersText(detail.requestHeaders), '请求头')">
              复制
            </el-button>
          </template>
          <UiCodeBlock wrap>
            {{ headersText(detail.requestHeaders) || '—' }}
          </UiCodeBlock>
        </UiPanel>
        <UiPanel variant="outlined" title="响应头">
          <template #actions>
            <el-button size="small" text type="primary" @click="useCopy(headersText(detail.responseHeaders), '响应头')">
              复制
            </el-button>
          </template>
          <UiCodeBlock wrap>
            {{ headersText(detail.responseHeaders) || '—' }}
          </UiCodeBlock>
        </UiPanel>
      </UiDetailGrid>

      <div v-if="detail.requestBody" class="body-section">
        <div class="detail-item-title">
          请求体
          <el-button size="small" text type="primary" @click="useCopy(detail.requestBody, '请求体')">
            复制
          </el-button>
        </div>
        <UiCodeBlock wrap max-height="260px">
          {{ detail.requestBody }}
        </UiCodeBlock>
      </div>
      <div v-if="detail.responseBody" class="body-section">
        <div class="detail-item-title">
          响应体
          <el-button size="small" text type="primary" @click="useCopy(detail.responseBody, '响应体')">
            复制
          </el-button>
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
      <el-button @click="detailVisible = false">
        关闭
      </el-button>
      <el-button v-if="detail" type="primary" @click="createRule(detail)">
        以此建规则
      </el-button>
    </template>
  </UiDialog>
</template>

<style scoped>
.url-cell {
  font-size: var(--font-size-sm);
}

:deep(.el-table__row) {
  cursor: pointer;
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
