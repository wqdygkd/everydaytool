<script setup lang="ts">
import type { AppAssetsDirectoryInfo, AppAssetsDirectoryUpdateResult, AppDataDirectoryInfo, AppDataDirectoryUpdateResult, CacheCleanResult, DataUsage } from '../../shared/app'
import type { MacVibrancy, WindowMaterial } from '../../shared/appearance'
import type { BackupExportResult, BackupInspectResult, BackupRestoreReport } from '../../shared/backup'
import type { WindowBoundsState } from '../../shared/window-bounds'
import { getSensitiveEntries } from '../../shared/data-layers'
import { useAppearance } from '../shared/composables/useAppearance'
import { appIpcChannels, invokeAppIpc } from '../shared/ipc/useAppIpc'

// 应用设置页：作为应用页签打开（见 config/app-tabs.ts），不再是模态对话框——
// 设置项里有数据目录、空间占用这类需要边看边操作的内容，占满一屏比弹窗更好用。
const { appearance, capabilities, load: loadAppearance, update: updateAppearance } = useAppearance()

const info = ref<AppDataDirectoryInfo | null>(null)
// 资产根：与数据目录同构的「只写 pending、重启迁移生效」流程，但它是**独立根**（可指到另一块盘）。
const assetsInfo = ref<AppAssetsDirectoryInfo | null>(null)
const assetsChanging = ref(false)
// 备份 / 恢复：唯一入口是主进程（文件选择、口令、恢复后的缓存失效都在主进程侧）
const backupBusy = ref(false)
const usage = ref<DataUsage | null>(null)
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

async function loadAssetsInfo() {
  try {
    assetsInfo.value = await invokeAppIpc<AppAssetsDirectoryInfo>(appIpcChannels().ASSETS_DIRECTORY_GET)
  } catch (error) {
    ElMessage.error((error as Error).message || '读取资产目录失败')
  }
}

async function openAssetsDirectory() {
  try {
    await invokeAppIpc(appIpcChannels().ASSETS_DIRECTORY_OPEN)
  } catch (error) {
    ElMessage.error((error as Error).message || '打开资产目录失败')
  }
}

async function selectAssetsDirectory() {
  let directory: string | null = null
  try {
    directory = await invokeAppIpc<string | null>(appIpcChannels().ASSETS_DIRECTORY_SELECT)
  } catch (error) {
    ElMessage.error((error as Error).message || '选择目录失败')
    return
  }
  if (!directory) return

  assetsChanging.value = true
  try {
    const result = await invokeAppIpc<AppAssetsDirectoryUpdateResult>(
      appIpcChannels().ASSETS_DIRECTORY_UPDATE,
      directory,
    )
    assetsInfo.value = result
    if (result.changed) {
      ElMessage.success('已记录新的资产目录；重启应用后会迁移并生效')
    } else {
      ElMessage.info('目录未发生变化')
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '更改资产目录失败')
  } finally {
    assetsChanging.value = false
  }
}

// ── 备份与恢复 ──
// 导出：先讲清「包内有什么（含敏感项）」，再问口令（可留空），最后交给主进程弹保存框。
async function exportBackup() {
  const sensitive = getSensitiveEntries()
  const sensitiveText = sensitive.length > 0
    ? `\n\n包内将包含以下敏感项（请妥善保管备份包）：\n· ${sensitive.map(entry => entry.label).join('\n· ')}`
    : ''

  let skipSensitive = false
  try {
    await ElMessageBox.confirm(
      `将导出「配置」层与资产清单（缓存层永不进包）。${sensitiveText}`,
      '导出备份',
      {
        confirmButtonText: '包含敏感项导出',
        cancelButtonText: '跳过敏感项导出',
        distinguishCancelAndClose: true,
        type: 'warning',
      },
    )
  } catch (action) {
    if (action === 'cancel') skipSensitive = true
    else return
  }

  let password = ''
  try {
    const answer = await ElMessageBox.prompt(
      '设置备份口令（可留空）。加口令后整个包用 AES-256-GCM 加密，恢复时必须输入同一口令。',
      '备份口令',
      { inputType: 'password', inputPlaceholder: '留空表示不加密', confirmButtonText: '继续导出', cancelButtonText: '取消' },
    )
    password = answer.value ?? ''
  } catch {
    return
  }

  backupBusy.value = true
  try {
    const result = await invokeAppIpc<BackupExportResult | null>(appIpcChannels().BACKUP_EXPORT, {
      password: password.trim() || undefined,
      skipSensitive,
    })
    if (!result) return
    const omitted = result.omittedSensitive.length > 0 ? `，跳过 ${result.omittedSensitive.length} 个敏感项` : ''
    ElMessage.success(`已导出 ${result.includedEntries.length} 项 / ${formatBytes(result.bytes)}${result.encrypted ? '（已加密）' : ''}${omitted}`)
  } catch (error) {
    ElMessage.error((error as Error).message || '导出备份失败')
  } finally {
    backupBusy.value = false
  }
}

// 恢复：预检（只读）→ 必要时补口令 → 展示摘要并确认 → 覆盖恢复
async function restoreBackup() {
  backupBusy.value = true
  try {
    const picked = await invokeAppIpc<BackupInspectResult | null>(appIpcChannels().BACKUP_INSPECT, null)
    if (!picked) return

    let inspected = picked
    let password = ''
    if (picked.needsPassword) {
      const answer = await ElMessageBox.prompt('该备份包已加密，请输入口令', '恢复备份', {
        inputType: 'password',
        confirmButtonText: '下一步',
        cancelButtonText: '取消',
      })
      password = answer.value ?? ''
      const withPassword = await invokeAppIpc<BackupInspectResult | null>(appIpcChannels().BACKUP_INSPECT, {
        filePath: picked.filePath,
        password,
      })
      if (!withPassword) return
      inspected = withPassword
    }

    const manifest = inspected.manifest
    if (!manifest) {
      ElMessage.error('无法读取备份包内容')
      return
    }
    if (!inspected.checksumOk) {
      ElMessage.error('备份包校验失败（内容与清单不一致），已中止恢复')
      return
    }

    const includeSession = manifest.strategy.session === true
    const lines = [
      `创建时间：${new Date(manifest.createdAt).toLocaleString()}`,
      `应用版本：${manifest.appVersion}`,
      `配置条目：${manifest.entries.length} 个 / ${formatBytes(manifest.totals.bytes)}`,
      `资产清单：${manifest.totals.assetFiles} 个（内容不在包内，恢复后按清单对账）`,
    ]
    if (includeSession) lines.push('包含会话层：恢复后需重启，Chromium 才会使用新的登录态')
    lines.push('', '现有配置会先快照到缓存层（可随时清掉），然后覆盖写入。是否继续？')

    await ElMessageBox.confirm(lines.join('\n'), '恢复备份', {
      confirmButtonText: '覆盖恢复',
      cancelButtonText: '取消',
      type: 'warning',
    })

    const report = await invokeAppIpc<BackupRestoreReport>(appIpcChannels().BACKUP_RESTORE, {
      filePath: inspected.filePath,
      password: password || undefined,
      includeSession,
    })

    const summary = [
      `已恢复 ${report.restoredEntries.length} 项`,
      report.missingAssets.length > 0 ? `资产清单中 ${report.missingAssets.length} 个文件在本机缺失（需另行恢复）` : '资产清单与本地一致',
      report.rollbackSnapshot ? `恢复前快照：${report.rollbackSnapshot}` : '恢复前无配置可快照',
      report.touchedSession ? '已写入会话层，请重启应用' : '',
      ...report.warnings.slice(0, 3),
    ].filter(Boolean)
    await ElMessageBox.alert(summary.join('\n'), '恢复完成', { confirmButtonText: '知道了' })
    await Promise.all([loadInfo(), loadAssetsInfo(), loadUsage()])
    if (report.touchedSession) ElMessage.info('会话数据已更新，重启应用后生效')
  } catch (error) {
    // 用户取消（prompt / confirm 抛 cancel）不当作错误
    const message = (error as Error)?.message ?? ''
    if (message && !/cancel|close/i.test(message)) ElMessage.error(message || '恢复备份失败')
  } finally {
    backupBusy.value = false
  }
}

async function loadUsage() {
  usageLoading.value = true
  try {
    usage.value = await invokeAppIpc<DataUsage>(appIpcChannels().DATA_USAGE_GET)
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
      '将删除「缓存」层（浏览器 Cache / Code Cache / GPU 缓存、工具下载与运行产物）以及「会话」层内部的浏览器缓存目录；\n配置（账号 / 规则 / 证书）、资产（归档）与登录态都不会被删除。',
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
  void loadAssetsInfo()
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
        配置、登录会话与可再生的缓存都存放在此目录（归档资产例外，见下方「数据分层」）。更改需重启：
        启动时会先整体迁移旧目录（含登录缓存），确认成功后才切换到新目录，因此缓存与登录态保持有效；
        目标目录必须为空。
      </UiHint>
    </UiPanel>

    <UiPanel title="数据分层">
      <template #actions>
        <el-button link size="small" :disabled="usageLoading" @click="loadUsage">
          刷新
        </el-button>
      </template>
      <p v-if="usage" class="usage-summary">
        总计 <span class="mono">{{ formatBytes(usage.totalBytes) }}</span>
        <span class="muted">·</span>
        可清理 <span class="mono">{{ formatBytes(usage.cleanableBytes) }}</span>
      </p>
      <ul v-if="usage" class="layer-list">
        <li v-for="layer in usage.layers" :key="layer.layer" class="layer-row">
          <div class="layer-head">
            <span class="layer-name">{{ layer.label }}</span>
            <UiChip :tone="layer.cleanable ? 'neutral' : 'warning'" variant="outline">
              {{ layer.cleanable ? '可再生' : '不可再生' }}
            </UiChip>
            <span class="mono layer-bytes">{{ formatBytes(layer.bytes) }}</span>
          </div>
          <p class="layer-summary">
            {{ layer.summary }}
          </p>
          <template v-if="layer.layer === 'assets'">
            <p class="layer-path mono">
              {{ assetsInfo?.assetsRoot ?? usage.assetsRoot }}
            </p>
            <p v-if="assetsInfo?.pendingAssetsRoot" class="layer-path mono">
              待切换 {{ assetsInfo.pendingAssetsRoot }}（重启后生效）
            </p>
            <p class="layer-summary">
              归档体量大且不可再生，可放到另一块盘：更改后下次启动会把旧位置的归档整体迁移过去（不覆盖非空目录）。
            </p>
            <UiGroup>
              <el-button size="small" @click="openAssetsDirectory">
                打开
              </el-button>
              <el-button size="small" :loading="assetsChanging" @click="selectAssetsDirectory">
                更改…
              </el-button>
            </UiGroup>
          </template>
          <details v-if="layer.entries.length > 0" class="layer-entries">
            <summary>{{ layer.entries.length }} 项明细</summary>
            <ul>
              <li v-for="entry in layer.entries" :key="entry.id" class="usage-row">
                <span class="usage-name">{{ entry.label }}</span>
                <span class="mono usage-bytes">{{ formatBytes(entry.bytes) }}</span>
              </li>
            </ul>
          </details>
        </li>
      </ul>
      <UiHint v-if="usageLoading" block>
        正在计算磁盘占用…
      </UiHint>
      <UiHint block>
        分层按「能不能重新生成」划分：配置与资产不可再生（备份要带上），会话是登录态，缓存随时可删。
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
        只清「缓存」层（含沙箱浏览器与各工具的下载 / 运行产物）和「会话」层内部的浏览器缓存目录。
        不会删除账号、规则、证书、登录态与归档；运行中的沙箱会自动跳过。
      </UiHint>
      <el-button :loading="cleaning" @click="clearCache">
        清除缓存
      </el-button>
    </UiPanel>

    <UiPanel title="备份与恢复">
      <UiHint block>
        备份包只装不可再生的数据：配置层（账号 / 规则 / 证书 / 索引）与资产清单；会话层可选，缓存层永不进包。
        恢复前会先把现有配置快照到缓存层，可回滚。
      </UiHint>
      <UiGroup>
        <el-button :loading="backupBusy" @click="exportBackup">
          导出备份…
        </el-button>
        <el-button :loading="backupBusy" @click="restoreBackup">
          从备份恢复…
        </el-button>
      </UiGroup>
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
    max-width: var(--column-document);
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

/* 面板之间留出区块间距（UiPanel 自身不带外边距）。
   2xl 而不是 md：这是**同级区块**之间的距离，必须明显大于面板内部
   标题→内容（12）与行间距（8），否则七个分区会糊成一整条长列表。 */
.settings-page > :deep(.ui-panel + .ui-panel) {
  margin-top: var(--spacing-2xl);
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
  /* 材质说明常折两行：11px 中文按 1.5 才不糊（与 .layer-summary 同一档） */
  line-height: 1.5;
}

.usage-summary {
  margin: var(--spacing-sm) 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);

  .muted {
    margin: 0 var(--spacing-xs);
  }
}

/* 数据分层：一层一行（名称 + 可再生标记 + 体积），条目明细折叠在 details 里。
   用列表而不是表格——层数固定为 4，表格的表头反而占地方。 */
.layer-list {
  margin: var(--spacing-sm) 0 0;
  padding: 0;
  list-style: none;
}

.layer-row {
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-light);

  &:first-child {
    border-top: none;
  }
}

.layer-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.layer-name {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.layer-bytes {
  margin-left: auto;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.layer-summary {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  /* 多行说明按 1.5 排（DESIGN §3.2.4）：11px 中文在 1.4 下行距只有 15.4px，会糊成一段 */
  line-height: 1.5;
}

/* 资产层的独立根路径：可能很长，允许换行而不是横向撑开 */
.layer-path {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.layer-entries {
  margin-top: var(--spacing-xs);

  summary {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }

  ul {
    max-height: 200px;
    margin: var(--spacing-xs) 0 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
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
