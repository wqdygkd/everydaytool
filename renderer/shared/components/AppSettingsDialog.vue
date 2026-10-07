<script setup lang="ts">
import type { AppDataDirectoryInfo, CacheCleanResult, DataRootUsage } from '../../../shared/types'
import { appIpcChannels, invokeAppIpc } from '../ipc/useAppIpc'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const info = ref<AppDataDirectoryInfo | null>(null)
const usage = ref<DataRootUsage | null>(null)
const usageLoading = ref(false)
const changing = ref(false)
const cleaning = ref(false)

watch(visible, (open) => {
  if (open) {
    loadInfo()
    loadUsage()
  }
})

async function loadInfo() {
  info.value = await invokeAppIpc<AppDataDirectoryInfo>(appIpcChannels.DATA_DIRECTORY_GET)
}

async function loadUsage() {
  usageLoading.value = true
  try {
    usage.value = await invokeAppIpc<DataRootUsage>(appIpcChannels.DATA_USAGE_GET)
  } finally {
    usageLoading.value = false
  }
}

async function openDirectory() {
  try {
    await invokeAppIpc(appIpcChannels.DATA_DIRECTORY_OPEN)
  } catch (error) {
    ElMessage.error((error as Error).message || '打开文件夹失败')
  }
}

async function selectDirectory() {
  const directory = await invokeAppIpc<string | null>(appIpcChannels.DATA_DIRECTORY_SELECT)
  if (!directory) return

  changing.value = true
  try {
    const result = await invokeAppIpc<AppDataDirectoryInfo & { changed: boolean }>(
      appIpcChannels.DATA_DIRECTORY_UPDATE,
      directory,
    )
    info.value = result
    if (result.changed) {
      ElMessage.success('数据目录已更新')
      loadUsage()
    } else {
      ElMessage.info('目录未发生变化')
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '更改数据目录失败')
  } finally {
    changing.value = false
  }
}

async function clearCache() {
  try {
    await ElMessageBox.confirm(
      '将删除数据目录下的浏览器缓存文件（Cache / Code Cache / GPU 缓存等），不影响配置与登录数据。',
      '清除缓存',
      { confirmButtonText: '清除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  cleaning.value = true
  try {
    const result = await invokeAppIpc<CacheCleanResult>(appIpcChannels.CACHE_CLEAR)
    if (result.skippedDirs > 0) {
      ElMessage.warning(`已释放 ${formatBytes(result.freedBytes)}，${result.skippedDirs} 个目录被占用或跳过`)
    } else if (result.cleanedDirs > 0) {
      ElMessage.success(`已释放 ${formatBytes(result.freedBytes)}`)
    } else {
      ElMessage.info('没有可清理的缓存')
    }
    loadUsage()
  } catch (error) {
    ElMessage.error((error as Error).message || '清除缓存失败')
  } finally {
    cleaning.value = false
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const value = bytes / 1024 ** exponent
  const text = exponent === 0 || Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${text} ${units[exponent]}`
}
</script>

<template>
  <el-dialog v-model="visible" title="应用设置" width="600px">
    <section class="settings-section">
      <h3>数据目录</h3>
      <div class="directory-row">
        <span class="directory-path mono">{{ info?.dataDirectory }}</span>
        <span class="chip">{{ info?.isCustom ? '自定义' : '默认' }}</span>
      </div>
      <div class="inline-group">
        <el-button size="small" @click="openDirectory">
          打开文件夹
        </el-button>
        <el-button size="small" :loading="changing" @click="selectDirectory">
          更改…
        </el-button>
      </div>
      <p class="form-hint">
        所有工具的数据库、配置与产出都存放在此目录；更改后立即生效，已有数据不会自动迁移到新目录。
      </p>
    </section>

    <section class="settings-section">
      <div class="section-header">
        <h3>空间占用</h3>
        <el-button link size="small" :disabled="usageLoading" @click="loadUsage">
          刷新
        </el-button>
      </div>
      <p v-if="usage" class="usage-summary">
        总计 <span class="mono">{{ formatBytes(usage.totalBytes) }}</span>
        <span class="muted">·</span>
        其中缓存 <span class="mono">{{ formatBytes(usage.cacheBytes) }}</span>
      </p>
      <ul v-if="usage && usage.entries.length > 0" class="usage-list">
        <li v-for="entry in usage.entries" :key="entry.name" class="usage-row">
          <span class="usage-name">{{ entry.name }}</span>
          <span class="mono usage-bytes">{{ formatBytes(entry.bytes) }}</span>
        </li>
      </ul>
      <p v-if="usageLoading" class="form-hint">
        正在计算磁盘占用…
      </p>
    </section>

    <section class="settings-section">
      <h3>清理缓存</h3>
      <p class="form-hint">
        清除沙箱浏览器产生的缓存文件，不影响配置与登录数据；运行中的沙箱会自动跳过。
      </p>
      <el-button :loading="cleaning" @click="clearCache">
        清除缓存
      </el-button>
    </section>
  </el-dialog>
</template>

<style scoped lang="scss">
.settings-section {
  & + & {
    margin-top: var(--spacing-lg);
    padding-top: var(--spacing-lg);
    border-top: 1px solid var(--color-border-light);
  }

  h3 {
    margin: 0 0 var(--spacing-sm);
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
  }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  h3 {
    margin-bottom: 0;
  }
}

.directory-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.directory-path {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  word-break: break-all;
}

.usage-summary {
  margin: var(--spacing-sm) 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);

  .muted {
    margin: 0 var(--spacing-xs);
  }
}

.usage-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow: auto;
}

.usage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: 6px 0;
  border-top: 1px solid var(--color-border-light);
  font-size: var(--font-size-sm);
}

.usage-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.usage-bytes {
  flex-shrink: 0;
  color: var(--color-text-primary);
}
</style>
