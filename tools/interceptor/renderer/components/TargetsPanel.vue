<script setup lang="ts">
import type { TargetMatchType } from '../../../../shared/interceptor'
import { useInterceptorStore } from '../stores/interceptorStore'

const store = useInterceptorStore()

const host = ref('')
const port = ref<number | undefined>()
const matchType = ref<TargetMatchType>('exact')

const matchTypeLabels: Record<TargetMatchType, string> = {
  exact: '精确',
  suffix: '后缀（含子域）',
  regex: '正则',
}

const isLoopbackInput = computed(() => /^(?:127\.|localhost$|::1$)/.test(host.value.trim()))

async function add(): Promise<void> {
  const trimmed = host.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入目标主机')
    return
  }
  if (isLoopbackInput.value && !port.value) {
    ElMessage.warning('回环目标必须带端口（如 127.0.0.1:8089），避免圈进本机所有服务')
    return
  }
  if (matchType.value === 'regex') {
    try {
      void new RegExp(trimmed)
    } catch {
      ElMessage.error('正则不合法')
      return
    }
  }
  try {
    await store.addTarget(trimmed, port.value, matchType.value)
    host.value = ''
    port.value = undefined
    ElMessage.success('已加入处理名单')
  } catch (error) {
    ElMessage.error((error as Error).message || '添加失败')
  }
}

async function remove(id: string): Promise<void> {
  await store.removeTarget(id)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <UiPanel title="处理名单">
    <UiHint>
      名单是 edt 处理层过滤器：命中才拆包 / 改包 / 记日志，其余走透传隧道（不拆 TLS）。
      空名单 = 全部透传；浏览器扩展弹窗也能对当前站点一键加入 / 移出。
    </UiHint>

    <UiGroup class="add-row" gap="sm">
      <el-input v-model="host" class="ctl-fill" placeholder="主机，如 api.example.com 或 127.0.0.1" @keyup.enter="add" />
      <el-input-number v-model="port" class="ctl-sm" :min="1" :max="65535" :controls="false" placeholder="端口（可选）" />
      <el-select v-model="matchType" class="ctl-md">
        <el-option v-for="(label, value) in matchTypeLabels" :key="value" :label="label" :value="value" />
      </el-select>
      <el-button type="primary" @click="add">
        加入名单
      </el-button>
    </UiGroup>

    <el-table :data="store.targets" size="small" empty-text="名单为空（全部透传）">
      <el-table-column label="目标" min-width="220">
        <template #default="{ row }">
          <span class="mono">{{ row.port ? `${row.host}:${row.port}` : row.host }}</span>
        </template>
      </el-table-column>
      <el-table-column label="匹配方式" width="140">
        <template #default="{ row }">
          <el-tag size="small" :type="row.matchType === 'exact' ? 'primary' : row.matchType === 'suffix' ? 'success' : 'warning'">
            {{ matchTypeLabels[row.matchType as TargetMatchType] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="加入时间" width="180">
        <template #default="{ row }">
          <span class="muted">{{ formatTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column width="90" align="right">
        <template #default="{ row }">
          <el-button size="small" text type="danger" @click="remove(row.id)">
            移出
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </UiPanel>
</template>

<style scoped>
.add-row {
  margin-bottom: var(--spacing-md);
}
</style>
