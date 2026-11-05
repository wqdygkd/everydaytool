<script setup lang="ts">
import type { InterceptorTarget } from '../../../../shared/interceptor'
import { toast } from 'vue-sonner'
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
    toast.warning('请输入 http(s) origin，如 https://www.a.com 或 http://127.0.0.1:8089')
    return
  }
  try {
    const result = await store.addTarget(origin)
    if (!result.target) {
      toast.error('无法解析成 origin（只支持 http / https）')
      return
    }
    originInput.value = ''
    if (result.existed) {
      toast.info(`「${origin}」已在名单里`)
      return
    }
    toast.success(`已加入：${origin}`)
  } catch (error) {
    toast.error((error as Error).message || '添加失败')
  }
}

/** 开关统一出口：后端没接受（多为旧进程）就明确提示，而不是让开关静默弹回 */
async function applyPatch(target: InterceptorTarget, patch: { enabled?: boolean, noCache?: boolean }): Promise<void> {
  try {
    const applied = await store.updateTarget(target.id, patch)
    if (!applied) toast.error('设置没生效：后端进程可能还是旧版本，请重启 edt 后再试')
  } catch (error) {
    toast.error((error as Error).message || '更新失败')
  }
}

/** UiTableColumn 插槽给的 row 是宽泛记录类型，这里收窄为名单条目类型。 */
function targetOf(row: unknown): InterceptorTarget {
  return row as InterceptorTarget
}

/** 开关入口：兼容 string | number | boolean，这里按开关语义取布尔。 */
async function toggleEnabled(target: InterceptorTarget, enabled: string | number | boolean): Promise<void> {
  await applyPatch(target, { enabled: enabled === true })
}

/** 强制回源（条目级）：该 origin 的响应去掉缓存控制，保证重复访问也能在流量页看到 */
async function toggleNoCache(target: InterceptorTarget, noCache: string | number | boolean): Promise<void> {
  await applyPatch(target, { noCache: noCache === true })
}

async function remove(target: InterceptorTarget): Promise<void> {
  await store.removeTarget(target.id)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div class="targets-pane">
    <header class="targets-toolbar">
      <UiInput
        v-model="originInput"
        class="target-input"
        placeholder="origin，如 https://www.a.com（粘整条 URL 会自动取 origin）"
        @keyup.enter="add"
      />
      <UiButton type="primary" :disabled="invalidInput" @click="add">
        加入名单
      </UiButton>
      <span class="toolbar-spacer" />
      <UiChip tone="success" variant="soft">
        启用 {{ enabledCount }} / {{ store.targets.length }}
      </UiChip>
    </header>

    <div v-if="previewOrigin && previewOrigin !== originInput.trim()" class="input-note">
      将存为 <span class="mono">{{ previewOrigin }}</span>
    </div>
    <div v-else-if="invalidInput" class="input-note is-error">
      只支持 http / https 的 origin，不支持通配符、路径或正则。
    </div>

    <UiTable
      class="targets-table"
      :data="store.targets"
      row-key="id"
      height="100%"
      empty-text="名单为空（全部透传，规则不会跑）"
    >
      <UiTableColumn label="origin" min-width="260">
        <template #default="{ row }">
          <span class="mono origin-text">{{ row.origin }}</span>
        </template>
      </UiTableColumn>
      <UiTableColumn label="启用" width="82">
        <template #default="{ row }">
          <UiSwitchField :model-value="row.enabled !== false" size="small" @update:model-value="(value: string | number | boolean) => toggleEnabled(targetOf(row), value)" />
        </template>
      </UiTableColumn>
      <UiTableColumn width="104">
        <template #header>
          <span class="ui-tip" title="该 origin 的响应去掉缓存控制，浏览器每次都真的发请求（关掉则允许缓存，重复访问可能不再出现）">
            <span>强制回源</span>
          </span>
        </template>
        <template #default="{ row }">
          <UiSwitchField :model-value="row.noCache !== false" size="small" @update:model-value="(value: string | number | boolean) => toggleNoCache(targetOf(row), value)" />
        </template>
      </UiTableColumn>
      <UiTableColumn label="加入时间" width="180">
        <template #default="{ row }">
          <span class="muted">{{ formatTime(row.createdAt) }}</span>
        </template>
      </UiTableColumn>
      <UiTableColumn width="82" align="right">
        <template #default="{ row }">
          <UiButton size="small" text type="danger" @click="remove(targetOf(row))">
            移出
          </UiButton>
        </template>
      </UiTableColumn>
    </UiTable>
    <footer class="targets-footnote">
      <span>处理名单是白名单闸门：只有命中的 origin 才会记录并进入规则匹配。</span>
      <span class="mono">一个条目 = 一个 origin</span>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.targets-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.targets-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 48px;
  height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.target-input {
  flex: 1;
  min-width: 240px;
}

.toolbar-spacer {
  flex: 1;
}

.input-note {
  padding: 7px 14px;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  &.is-error {
    color: var(--color-error);
  }
}

.targets-table {
  flex: 1;
  min-height: 0;
}

.targets-table :deep(.ui-table-wrap) {
  height: 100%;
  border-radius: 0;
}

.targets-footnote {
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
  }
}

.origin-text {
  font-weight: var(--font-weight-medium);
  word-break: break-all;
}
</style>
