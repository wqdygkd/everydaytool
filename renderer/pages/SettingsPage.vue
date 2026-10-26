<script setup lang="ts">
import type { AppDataDirectoryInfo, AppDataDirectoryUpdateResult, CacheCleanResult, DataRootUsage } from '../../shared/app'
import type { MacVibrancy, WindowMaterial } from '../../shared/appearance'
import type { WindowBoundsState } from '../../shared/window-bounds'
import { useAppearance } from '../shared/composables/useAppearance'
import { appIpcChannels, invokeAppIpc } from '../shared/ipc/useAppIpc'

// 应用设置页：作为应用页签打开（见 config/app-tabs.ts），不再是模态对话框——
// 设置项里有数据目录、空间占用这类需要边看边操作的内容，占满一屏比弹窗更好用。
const { appearance, capabilities, load: loadAppearance, update: updateAppearance } = useAppearance()

const info = ref<AppDataDirectoryInfo | null>(null)
const usage = ref<DataRootUsage | null>(null)
const usageLoading = ref(false)
const changing = ref(false)
const cleaning = ref(false)

// ── 窗口外观 ──
// 平台能力由主进程给出：不支持半透明的平台直接禁用整组，而不是给一个点了没反应的开关。
const isTransparentEnabled = computed(() => capabilities.value?.supportsTransparent === true)
const isMaterialEnabled = computed(() => capabilities.value?.supportsMaterial === true)
const isVibrancyEnabled = computed(() => (capabilities.value?.vibrancies.length ?? 0) > 0)

// 开关状态：appearance 允许为 null（尚未加载完成），故收敛成 boolean 后由模板用
// :model-value + @update 显式提交 IPC——不对 appearance 本身做 v-model 双向绑定。
const transparentOn = computed(() => appearance.value?.enabled === true)
const testWallpaperOn = computed(() => appearance.value?.testWallpaper === true)

interface MaterialChoice {
  /** 材质标识：Windows 落在 material 字段，macOS 落在 vibrancy 字段，值域互不重叠 */
  value: WindowMaterial | MacVibrancy
  label: string
  description: string
}

// 两套平台的材质字段不同（Windows 走 DWM material，macOS 走 vibrancy），
// 但交互完全一致——一张卡片单选。故统一成同一份选项结构，由平台能力挑一路渲染。
const MATERIAL_CHOICES: MaterialChoice[] = [
  { value: 'mica', label: 'Mica', description: '壁纸取色的长驻窗口背景' },
  { value: 'acrylic', label: '亚克力', description: '更强的模糊与透光，偏向临时浮层' },
  { value: 'tabbed', label: 'Tabbed', description: '带页签标题栏的弱化材质' },
]
const VIBRANCY_CHOICES: MaterialChoice[] = [
  { value: 'sidebar', label: '侧栏', description: '接近系统侧栏的浅色模糊' },
  { value: 'hud', label: 'HUD', description: '高对比深色浮动面板' },
  { value: 'under-window', label: '窗下', description: '窗口背后的柔和模糊' },
  { value: 'fullscreen-ui', label: '全屏 UI', description: '全屏界面用的轻模糊' },
]

const materialChoices = computed<MaterialChoice[]>(() => {
  if (isMaterialEnabled.value) return MATERIAL_CHOICES
  if (isVibrancyEnabled.value) return VIBRANCY_CHOICES
  return []
})

// 当前选中的材质：与 materialChoices 同源，两路字段互斥，取生效的那一路即当前值
const selectedMaterial = computed(() =>
  (isMaterialEnabled.value ? appearance.value?.material : appearance.value?.vibrancy) ?? 'none',
)

const appearanceHint = computed(() => {
  if (!capabilities.value) return ''
  if (!capabilities.value.supportsTransparent) {
    return '当前系统不支持半透明窗口（Linux 需合成器支持），该选项已禁用。'
  }
  if (appearance.value?.enabled) {
    return '各表面按当前材质的 alpha + 玻璃档位透出桌面；可用下方「测试壁纸」比对磨砂程度。'
  }
  return '开启后窗口画布透出桌面壁纸，可再选择系统背景材质。'
})

async function toggleTransparent(value: boolean) {
  await updateAppearance({ enabled: value })
}

async function chooseMaterial(value: WindowMaterial | MacVibrancy) {
  // 选项值来自上面两路的并集，这里按当前生效的那一路收回各自字段
  if (isMaterialEnabled.value) await updateAppearance({ material: value as WindowMaterial })
  else await updateAppearance({ vibrancy: value as MacVibrancy })
}

// 测试壁纸：纯 CSS 的调试辅助，与平台能力 / 半透明开关都无关，
// 因此不受 isTransparentEnabled / isMaterialEnabled 约束——不透明窗口下也能开，
// 用来检查卡片底色压在高对比背景上是否还够干净。
async function toggleTestWallpaper(value: boolean) {
  await updateAppearance({ testWallpaper: value })
}

// ── 窗口大小与位置 ──
// 与外观同理：唯一事实来源是主进程（<data>/app/window-bounds.json），这里只读当前记录、
// 提交开关 / 重置。具体几何由主进程在 move / resize 时自己记，渲染层不经手。
const bounds = ref<WindowBoundsState | null>(null)
const boundsResetting = ref(false)
const rememberBoundsOn = computed(() => bounds.value?.enabled === true)

async function loadBounds() {
  try {
    bounds.value = await invokeAppIpc<WindowBoundsState>(appIpcChannels().WINDOW_BOUNDS_GET)
  } catch (error) {
    ElMessage.error((error as Error).message || '读取窗口位置记录失败')
  }
}

async function toggleRememberBounds(value: boolean) {
  try {
    bounds.value = await invokeAppIpc<WindowBoundsState>(appIpcChannels().WINDOW_BOUNDS_SET, value)
  } catch (error) {
    ElMessage.error((error as Error).message || '切换窗口位置记忆失败')
  }
}

async function resetBounds() {
  boundsResetting.value = true
  try {
    bounds.value = await invokeAppIpc<WindowBoundsState>(appIpcChannels().WINDOW_BOUNDS_RESET)
    ElMessage.success('已恢复默认大小并居中')
  } catch (error) {
    ElMessage.error((error as Error).message || '重置窗口大小失败')
  } finally {
    boundsResetting.value = false
  }
}

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
    const result = await invokeAppIpc<AppDataDirectoryUpdateResult>(
      appIpcChannels().DATA_DIRECTORY_UPDATE,
      directory,
    )
    info.value = result
    if (result.changed) {
      ElMessage.success('已记录新的数据目录；重启应用后会整体迁移并生效')
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

// 调试控制台：主进程为当前窗口开一个独立 DevTools 窗口（undocked，可再停靠回去）。
// 重复点击只会把它拉到前台，不会关掉——按钮语义是「打开」而不是「切换」。
async function openDevTools() {
  try {
    await invokeAppIpc(appIpcChannels().DEVTOOLS_OPEN)
  } catch (error) {
    ElMessage.error((error as Error).message || '打开调试控制台失败')
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

// 页签常驻挂载（切走只是 v-show 隐藏），因此只在首次挂载时拉一次数据；
// 之后由各操作自己触发刷新（改目录 / 清缓存后各刷一次）。
onMounted(() => {
  void loadInfo()
  void loadUsage()
  void loadAppearance()
  void loadBounds()
})
</script>

<template>
  <div class="settings-page tool-page">
    <!-- 不再放「应用设置」大标题：页签本身已经叫「设置」，
         标题会与页签重复一行。这里只留一句总说明，各面板自带小标题。 -->
    <UiHint class="settings-lead">
      数据目录、空间占用与窗口外观等应用级配置；这里的改动立即生效。
    </UiHint>

    <UiPanel title="数据目录">
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
      <div v-if="info?.pendingDataDirectory" class="directory-row">
        <span class="muted">待切换</span>
        <span class="directory-path mono">{{ info.pendingDataDirectory }}</span>
        <UiChip tone="warning">
          重启后生效
        </UiChip>
      </div>
      <UiHint block>
        所有工具的配置、缓存与产出都存放在此目录。更改需重启：启动时会先整体迁移旧目录（含登录缓存），
        确认成功后才切换到新目录，因此缓存与登录态保持有效；目标目录必须为空。
      </UiHint>
    </UiPanel>

    <UiPanel title="空间占用">
      <template #actions>
        <el-button link size="small" :disabled="usageLoading" @click="loadUsage">
          刷新
        </el-button>
      </template>
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
    </UiPanel>

    <UiPanel title="窗口外观">
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
        <template v-if="materialChoices.length > 0">
          <span class="material-label">系统材质</span>
          <div class="material-options">
            <button
              v-for="option in materialChoices"
              :key="option.value"
              type="button"
              class="material-option"
              :class="{ 'is-active': selectedMaterial === option.value }"
              @click="chooseMaterial(option.value)"
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

      <div class="wallpaper-toggle">
        <UiSwitchField :model-value="testWallpaperOn" align="start" @update:model-value="toggleTestWallpaper">
          测试壁纸
          <template v-if="!appearance?.enabled">
            （半透明未开启，仅预览底色）
          </template>
        </UiSwitchField>
        <UiHint block>
          在窗口最底层铺一张高对比色块假壁纸，用于比对卡片 / 浮层 / 标题栏的磨砂与透视程度；
          关闭后恢复透出真实桌面。
        </UiHint>
      </div>
    </UiPanel>

    <UiPanel title="窗口大小与位置">
      <UiSwitchField :model-value="rememberBoundsOn" align="start" @update:model-value="toggleRememberBounds">
        记住窗口大小与位置
      </UiSwitchField>
      <UiHint block>
        启动时恢复上次退出前的尺寸与位置（含最大化状态）。若记录落在已拔掉的外接屏上或超出了当前屏幕，
        会改回默认尺寸并居中，不会把窗口还原到屏幕外。
      </UiHint>
      <div class="bounds-row">
        <span class="muted">上次记录</span>
        <span v-if="bounds?.bounds" class="mono">
          {{ bounds.bounds.width }} × {{ bounds.bounds.height }}{{ bounds.maximized ? '（最大化）' : '' }}
        </span>
        <span v-else class="muted">暂无记录，按默认尺寸居中</span>
      </div>
      <UiGroup>
        <el-button size="small" :loading="boundsResetting" @click="resetBounds">
          重置为默认大小
        </el-button>
      </UiGroup>
    </UiPanel>

    <UiPanel title="清理缓存">
      <UiHint block>
        清除沙箱浏览器产生的缓存文件，不影响配置与登录数据；运行中的沙箱会自动跳过。
      </UiHint>
      <el-button :loading="cleaning" @click="clearCache">
        清除缓存
      </el-button>
    </UiPanel>

    <UiPanel title="调试">
      <UiHint block>
        在独立窗口中打开 DevTools，用于查看渲染层日志、网络请求与内存快照；关闭该窗口即可收起。
      </UiHint>
      <el-button @click="openDevTools">
        打开调试控制台
      </el-button>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
/* 页面级宽度：设置项不需要铺满整个窗口，长行（路径 / 用量）反而更难读。
   内边距与首页一致（2xl / 3xl），保证与其它页面同一留白节奏。 */
.settings-page {
  padding: var(--spacing-2xl) var(--spacing-3xl) var(--spacing-3xl);

  > :deep(*) {
    max-width: 760px;
    margin-right: auto;
    margin-left: auto;
  }
}

@media (max-width: 640px) {
  .settings-page {
    padding: var(--spacing-2xl) var(--spacing-lg) var(--spacing-3xl);
  }
}

/* 引导说明：不是块级（不需要 margin-top），只与首个面板拉开距离 */
.settings-lead {
  margin-bottom: var(--spacing-lg);
}

/* 面板之间留出区块间距（UiPanel 自身不带外边距） */
.settings-page > :deep(.ui-panel + .ui-panel) {
  margin-top: var(--spacing-lg);
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

/* 窗口位置面板的记录摘要：与数据目录那行同构造（弱化标签 + 等宽值），只是值更短 */
.bounds-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  margin: var(--spacing-sm) 0;
  font-size: var(--font-size-sm);
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

/* 测试壁纸开关：与上方的半透明 / 材质选项之间留出分隔，表明它是独立的调试项 */
.wallpaper-toggle {
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border-light);
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
