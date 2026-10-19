<script setup lang="ts">
import type { AppDataDirectoryInfo, CacheCleanResult, DataRootUsage } from '../../../shared/app'
import type { MacVibrancy, WindowMaterial } from '../../../shared/appearance'
import { useAppearance } from '../composables/useAppearance'
import { appIpcChannels, invokeAppIpc } from '../ipc/useAppIpc'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const { appearance, capabilities, load: loadAppearance, update: updateAppearance } = useAppearance()

const info = ref<AppDataDirectoryInfo | null>(null)
const usage = ref<DataRootUsage | null>(null)
const usageLoading = ref(false)
const changing = ref(false)
const cleaning = ref(false)

watch(visible, (open) => {
  if (open) {
    loadInfo()
    loadUsage()
    loadAppearance()
  }
})

// ── 窗口外观 ──
// 平台能力由主进程给出：不支持半透明的平台直接禁用整组，而不是给一个点了没反应的开关。
const isTransparentEnabled = computed(() => capabilities.value?.supportsTransparent === true)
const isMaterialEnabled = computed(() => capabilities.value?.supportsMaterial === true)
const isVibrancyEnabled = computed(() => (capabilities.value?.vibrancies.length ?? 0) > 0)
const materialOptions = computed<Array<{ value: WindowMaterial, label: string, description: string }>>(() => [
  { value: 'mica', label: 'Mica', description: '壁纸取色的长驻窗口背景' },
  { value: 'acrylic', label: '亚克力', description: '更强的模糊与透光，偏向临时浮层' },
  { value: 'tabbed', label: 'Tabbed', description: '带页签标题栏的弱化材质' },
])
const vibrancyOptions = computed<Array<{ value: MacVibrancy, label: string, description: string }>>(() => [
  { value: 'sidebar', label: '侧栏', description: '接近系统侧栏的浅色模糊' },
  { value: 'hud', label: 'HUD', description: '高对比深色浮动面板' },
  { value: 'under-window', label: '窗下', description: '窗口背后的柔和模糊' },
  { value: 'fullscreen-ui', label: '全屏 UI', description: '全屏界面用的轻模糊' },
])

const appearanceHint = computed(() => {
  if (!capabilities.value) return ''
  if (!capabilities.value.supportsTransparent) {
    return '当前系统不支持半透明窗口（Linux 需合成器支持），该选项已禁用。'
  }
  if (appearance.value?.enabled) {
    return '卡片、输入框与表格仍保持不透明以保证可读性；仅窗口画布与顶栏透出桌面。'
  }
  return '开启后窗口画布透出桌面壁纸，可再选择系统背景材质。'
})

async function toggleTransparent(value: boolean) {
  await updateAppearance({ enabled: value })
}

async function selectMaterial(material: WindowMaterial) {
  await updateAppearance({ material })
}

async function selectVibrancy(vibrancy: MacVibrancy) {
  await updateAppearance({ vibrancy })
}

// 开关用 :model-value + @change 直接走 IPC：appearance 允许为 null（未加载），
// 不能对它做 v-model 双向绑定。
const transparentOn = computed(() => appearance.value?.enabled === true)

async function loadInfo() {
  try {
    info.value = await invokeAppIpc<AppDataDirectoryInfo>(appIpcChannels().DATA_DIRECTORY_GET)
  } catch (error) {
    ElMessage.error((error as Error).message || '读取数据目录失败')
  }
}

async function loadUsage() {
  usageLoading.value = true
  try {
    usage.value = await invokeAppIpc<DataRootUsage>(appIpcChannels().DATA_USAGE_GET)
  } catch (error) {
    ElMessage.error((error as Error).message || '计算空间占用失败')
  } finally {
    usageLoading.value = false
  }
}

async function openDirectory() {
  try {
    await invokeAppIpc(appIpcChannels().DATA_DIRECTORY_OPEN)
  } catch (error) {
    ElMessage.error((error as Error).message || '打开文件夹失败')
  }
}

async function selectDirectory() {
  let directory: string | null = null
  try {
    directory = await invokeAppIpc<string | null>(appIpcChannels().DATA_DIRECTORY_SELECT)
  } catch (error) {
    ElMessage.error((error as Error).message || '选择目录失败')
    return
  }
  if (!directory) return

  changing.value = true
  try {
    const result = await invokeAppIpc<AppDataDirectoryInfo & { changed: boolean }>(
      appIpcChannels().DATA_DIRECTORY_UPDATE,
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
    const result = await invokeAppIpc<CacheCleanResult>(appIpcChannels().CACHE_CLEAR)
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
  <UiDialog v-model="visible" title="应用设置" width="600px">
    <section class="settings-section">
      <h3>数据目录</h3>
      <div class="directory-row">
        <span class="directory-path mono">{{ info?.dataDirectory }}</span>
        <UiChip>{{ info?.isCustom ? '自定义' : '默认' }}</UiChip>
      </div>
      <UiGroup>
        <el-button size="small" @click="openDirectory">
          打开文件夹
        </el-button>
        <el-button size="small" :loading="changing" @click="selectDirectory">
          更改…
        </el-button>
      </UiGroup>
      <UiHint block>
        所有工具的数据库、配置与产出都存放在此目录；更改后立即生效，已有数据不会自动迁移到新目录。
      </UiHint>
    </section>

    <section class="settings-section">
      <UiToolbar>
        <h3>空间占用</h3>
        <template #end>
          <el-button link size="small" :disabled="usageLoading" @click="loadUsage">
            刷新
          </el-button>
        </template>
      </UiToolbar>
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
      <UiHint v-if="usageLoading" block>
        正在计算磁盘占用…
      </UiHint>
    </section>

    <section class="settings-section">
      <h3>窗口外观</h3>
      <UiSwitchField :model-value="transparentOn" :disabled="!isTransparentEnabled" align="start" @update:model-value="toggleTransparent">
        半透明窗口
        <template v-if="!isTransparentEnabled">
          （当前系统不支持）
        </template>
      </UiSwitchField>
      <UiHint block>
        {{ appearanceHint }}
      </UiHint>

      <div v-if="isTransparentEnabled && appearance?.enabled" class="material-picker">
        <template v-if="isMaterialEnabled">
          <span class="material-label">系统材质</span>
          <div class="material-options">
            <button
              v-for="option in materialOptions"
              :key="option.value"
              type="button"
              class="material-option"
              :class="{ 'is-active': appearance.material === option.value }"
              @click="selectMaterial(option.value)"
            >
              <span class="material-name">{{ option.label }}</span>
              <span class="material-desc">{{ option.description }}</span>
            </button>
          </div>
        </template>
        <template v-else-if="isVibrancyEnabled">
          <span class="material-label">系统材质</span>
          <div class="material-options">
            <button
              v-for="option in vibrancyOptions"
              :key="option.value"
              type="button"
              class="material-option"
              :class="{ 'is-active': appearance.vibrancy === option.value }"
              @click="selectVibrancy(option.value)"
            >
              <span class="material-name">{{ option.label }}</span>
              <span class="material-desc">{{ option.description }}</span>
            </button>
          </div>
        </template>
        <UiHint v-else block>
          当前系统没有可用的系统背景材质，仅窗口画布会透出桌面。
        </UiHint>
      </div>
    </section>

    <section class="settings-section">
      <h3>清理缓存</h3>
      <UiHint block>
        清除沙箱浏览器产生的缓存文件，不影响配置与登录数据；运行中的沙箱会自动跳过。
      </UiHint>
      <el-button :loading="cleaning" @click="clearCache">
        清除缓存
      </el-button>
    </section>
  </UiDialog>
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

/* UiToolbar 行内的 h3 不需要节标题的默认下边距 */
.settings-section .ui-toolbar h3 {
  margin-bottom: 0;
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

/* 材质选择：卡片式单选（比 el-radio 更容易表达「这是哪种视觉」） */
.material-picker {
  margin-top: var(--spacing-md);
}

.material-label {
  display: block;
  margin-bottom: var(--spacing-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.material-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--spacing-sm);
}

.material-option {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-raised);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: var(--transition-fast);

  &:hover {
    border-color: var(--color-border);
  }

  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.material-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.material-desc {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.4;
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
  padding: var(--spacing-sm) 0;
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
