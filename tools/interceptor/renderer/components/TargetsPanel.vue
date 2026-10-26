<script setup lang="ts">
import type { InterceptorTarget } from '../../../../shared/interceptor'
import { parseTargetOrigin } from '../../../../shared/interceptor'
import { useInterceptorStore } from '../stores/interceptorStore'

const store = useInterceptorStore()

const originInput = ref('')

/** 输入预览：实时告诉用户会存成什么 origin（纯域名默认 https，回环默认 http） */
const previewOrigin = computed(() => (originInput.value.trim() ? parseTargetOrigin(originInput.value) : null))
const invalidInput = computed(() => originInput.value.trim().length > 0 && previewOrigin.value === null)

const enabledCount = computed(() => store.targets.filter(target => target.enabled !== false).length)

async function add(): Promise<void> {
  const origin = previewOrigin.value
  if (!origin) {
    ElMessage.warning('请输入 http(s) origin，如 https://www.a.com 或 http://127.0.0.1:8089')
    return
  }
  try {
    const result = await store.addTarget(origin)
    if (!result.target) {
      ElMessage.error('无法解析成 origin（只支持 http / https）')
      return
    }
    originInput.value = ''
    if (result.existed) {
      ElMessage.info(`「${origin}」已在名单里`)
      return
    }
    ElMessage.success(`已加入：${origin}`)
  } catch (error) {
    ElMessage.error((error as Error).message || '添加失败')
  }
}

/** 开关统一出口：后端没接受（多为旧进程）就明确提示，而不是让开关静默弹回 */
async function applyPatch(target: InterceptorTarget, patch: { enabled?: boolean, noCache?: boolean }): Promise<void> {
  try {
    const applied = await store.updateTarget(target.id, patch)
    if (!applied) ElMessage.error('设置没生效：后端进程可能还是旧版本，请重启 edt 后再试')
  } catch (error) {
    ElMessage.error((error as Error).message || '更新失败')
  }
}

async function toggleEnabled(target: InterceptorTarget, enabled: boolean): Promise<void> {
  await applyPatch(target, { enabled })
}

/** 强制回源（条目级）：该 origin 的响应去掉缓存控制，保证重复访问也能在流量页看到 */
async function toggleNoCache(target: InterceptorTarget, noCache: boolean): Promise<void> {
  await applyPatch(target, { noCache })
}

async function remove(target: InterceptorTarget): Promise<void> {
  await store.removeTarget(target.id)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <UiPanel title="处理名单">
    <template #actions>
      <UiChip tone="success" variant="soft">
        启用 {{ enabledCount }} / {{ store.targets.length }}
      </UiChip>
    </template>

    <UiHint block>
      处理名单是<strong>白名单闸门</strong>：只有请求的 origin（协议 + 域名 + 端口）命中条目，请求才会被拆包、记录，
      并交给<strong>规则</strong>去匹配；没命中就整条透传——不改包、不记录、规则一条都不跑。
      这份名单只决定"进不进规则"，"这个地址怎么处理"（改请求 / 改响应 / 重定向 / Mock）全在规则页配。
    </UiHint>
    <UiHint block>
      一个条目 = 一个 origin。<span class="mono">https://www.a.com</span> 只匹配 https + 443；
      <span class="mono">http://127.0.0.1:8089</span> 只匹配该端口。默认端口会省略，纯域名默认按
      <span class="mono">https</span> 处理（回环 / localhost 默认 <span class="mono">http</span>），要 http 站点就带上协议。
    </UiHint>
    <UiHint block>
      「强制回源」（默认开）= 该 origin 的响应去掉 <span class="mono">cache-control</span> / <span class="mono">etag</span> 等缓存头，
      浏览器每次都会真的发请求，流量页才看得到重复访问的资源；关掉即恢复正常缓存（重复请求可能不再出现）。
      开关打开前已经缓存进浏览器的资源，还要强刷一次才会回源。
    </UiHint>

    <UiGroup class="add-row" gap="sm" wrap>
      <el-input
        v-model="originInput"
        class="ctl-fill"
        placeholder="origin，如 https://www.a.com（粘整条 URL 会自动取 origin）"
        @keyup.enter="add"
      />
      <el-button type="primary" :disabled="invalidInput" @click="add">
        加入名单
      </el-button>
    </UiGroup>
    <UiHint v-if="previewOrigin && previewOrigin !== originInput.trim()" block>
      将存为 <span class="mono">{{ previewOrigin }}</span>
    </UiHint>
    <UiHint v-else-if="invalidInput" block>
      只支持 http / https 的 origin（不支持通配符、路径、正则——按路径 / 正则筛请在规则里配）。
    </UiHint>

    <UiTable
      :data="store.targets"
      row-key="id"
      empty-text="名单为空（全部透传，规则不会跑）"
    >
      <el-table-column label="origin" min-width="260">
        <template #default="{ row }: { row: InterceptorTarget }">
          <span class="mono origin-text">{{ row.origin }}</span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="82">
        <template #default="{ row }: { row: InterceptorTarget }">
          <el-switch :model-value="row.enabled !== false" size="small" @change="(value: boolean) => toggleEnabled(row, value)" />
        </template>
      </el-table-column>
      <el-table-column width="104">
        <template #header>
          <el-tooltip content="该 origin 的响应去掉缓存控制，浏览器每次都真的发请求（关掉则允许缓存，重复访问可能不再出现）" placement="top">
            <span>强制回源</span>
          </el-tooltip>
        </template>
        <template #default="{ row }: { row: InterceptorTarget }">
          <el-switch :model-value="row.noCache !== false" size="small" @change="(value: boolean) => toggleNoCache(row, value)" />
        </template>
      </el-table-column>
      <el-table-column label="加入时间" width="180">
        <template #default="{ row }: { row: InterceptorTarget }">
          <span class="muted">{{ formatTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column width="82" align="right">
        <template #default="{ row }: { row: InterceptorTarget }">
          <el-button size="small" text type="danger" @click="remove(row)">
            移出
          </el-button>
        </template>
      </el-table-column>
    </UiTable>
  </UiPanel>
</template>

<style scoped>
.add-row {
  margin-bottom: var(--spacing-sm);
}

.origin-text {
  font-weight: var(--font-weight-semibold);
  word-break: break-all;
}
</style>
