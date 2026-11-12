<script setup lang="ts">
import type { AppAssetsDirectoryInfo, AppAssetsDirectoryUpdateResult, AppDataDirectoryInfo, AppDataDirectoryUpdateResult, CacheCleanResult, DataUsage } from '../../shared/app'
import type { MacVibrancy, WindowMaterial } from '../../shared/appearance'
import type { BackupExportResult, BackupInspectResult, BackupRestoreReport } from '../../shared/backup'
import type { WindowBoundsState } from '../../shared/window-bounds'
import { alert, confirm, prompt } from '@renderer/shared/feedback'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
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

const cleanablePercent = computed(() => {
  const total = usage.value?.totalBytes ?? 0
  const cleanable = usage.value?.cleanableBytes ?? 0
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((cleanable / total) * 100)))
})

interface SettingsNavItem {
  id: string
  label: string
}

interface SettingsNavGroup {
  group: string
  items: SettingsNavItem[]
}

const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    group: '数据与存储',
    items: [
      { id: 'data-directory', label: '数据目录' },
      { id: 'data-layers', label: '数据分层' },
      { id: 'cache', label: '清理缓存' },
      { id: 'backup', label: '备份与恢复' },
    ],
  },
  {
    group: '窗口',
    items: [
      { id: 'appearance', label: '窗口外观' },
      { id: 'bounds', label: '大小与位置' },
    ],
  },
  {
    group: '高级',
    items: [
      { id: 'debug', label: '调试' },
    ],
  },
]
const SETTINGS_ITEMS = SETTINGS_NAV.flatMap(group => group.items)

const pageRef = ref<HTMLElement | null>(null)
const activeSetting = ref(SETTINGS_ITEMS[0].id)
// 索引跳转期间锁住滚动位置回写：目标分区被夹在滚动末端时（例如「窗口外观」
// 下方只剩两屏内容），落点会停在最大滚动位置，滚动监听会把高亮翻成末项「调试」。
let spyLocked = false
let spyUnlockTimer: number | undefined

function updateActiveSetting() {
  if (spyLocked) return
  const page = pageRef.value
  if (!page) return
  const threshold = page.getBoundingClientRect().top + 96
  const maxScroll = page.scrollHeight - page.clientHeight
  const atBottom = maxScroll > 0 && maxScroll - page.scrollTop < 24
  let active = SETTINGS_ITEMS[0].id
  for (const item of SETTINGS_ITEMS) {
    const el = page.querySelector<HTMLElement>(`[data-setting="${item.id}"]`)
    if (el && el.getBoundingClientRect().top <= threshold) active = item.id
  }
  if (atBottom) {
    active = SETTINGS_ITEMS[SETTINGS_ITEMS.length - 1].id
  }
  activeSetting.value = active
}

function scrollToSetting(id: string) {
  const el = pageRef.value?.querySelector<HTMLElement>(`[data-setting="${id}"]`)
  if (!el) return
  spyLocked = true
  activeSetting.value = id
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  window.clearTimeout(spyUnlockTimer)
  spyUnlockTimer = window.setTimeout(() => {
    spyLocked = false
  }, 700)
}

useEventListener(window, 'resize', updateActiveSetting)

// ── 窗口外观 ──
// 平台能力由主进程给出：不支持半透明的平台直接禁用整组，而不是给一个点了没反应的开关。
const isTransparentEnabled = computed(() => capabilities.value?.supportsTransparent === true)
const isMaterialEnabled = computed(() => capabilities.value?.supportsMaterial === true)
const isVibrancyEnabled = computed(() => (capabilities.value?.vibrancies.length ?? 0) > 0)

// 开关状态：appearance 允许为 null（尚未加载完成），故收敛成 boolean 后由模板用
// :model-value + @update 显式提交 IPC——不对 appearance 本身做 v-model 双向绑定。
const transparentOn = computed(() => appearance.value?.enabled === true)
const nightOn = computed(() => appearance.value?.night === true)

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
    return '各表面按当前材质的 alpha + 玻璃档位透出桌面。'
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

async function toggleNight(value: boolean) {
  await updateAppearance({ night: value })
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
    toast.error((error as Error).message || '读取窗口位置记录失败')
  }
}

async function toggleRememberBounds(value: boolean) {
  try {
    bounds.value = await invokeAppIpc<WindowBoundsState>(appIpcChannels().WINDOW_BOUNDS_SET, value)
  } catch (error) {
    toast.error((error as Error).message || '切换窗口位置记忆失败')
  }
}

async function resetBounds() {
  boundsResetting.value = true
  try {
    bounds.value = await invokeAppIpc<WindowBoundsState>(appIpcChannels().WINDOW_BOUNDS_RESET)
    toast.success('已恢复默认大小并居中')
  } catch (error) {
    toast.error((error as Error).message || '重置窗口大小失败')
  } finally {
    boundsResetting.value = false
  }
}

async function loadInfo() {
  try {
    info.value = await invokeAppIpc<AppDataDirectoryInfo>(appIpcChannels().DATA_DIRECTORY_GET)
  } catch (error) {
    toast.error((error as Error).message || '读取数据目录失败')
  }
}

async function loadAssetsInfo() {
  try {
    assetsInfo.value = await invokeAppIpc<AppAssetsDirectoryInfo>(appIpcChannels().ASSETS_DIRECTORY_GET)
  } catch (error) {
    toast.error((error as Error).message || '读取资产目录失败')
  }
}

async function openAssetsDirectory() {
  try {
    await invokeAppIpc(appIpcChannels().ASSETS_DIRECTORY_OPEN)
  } catch (error) {
    toast.error((error as Error).message || '打开资产目录失败')
  }
}

async function selectAssetsDirectory() {
  let directory: string | null = null
  try {
    directory = await invokeAppIpc<string | null>(appIpcChannels().ASSETS_DIRECTORY_SELECT)
  } catch (error) {
    toast.error((error as Error).message || '选择目录失败')
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
      toast.success('已记录新的资产目录；重启应用后会迁移并生效')
    } else {
      toast.info('目录未发生变化')
    }
  } catch (error) {
    toast.error((error as Error).message || '更改资产目录失败')
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
    await confirm(
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
    const answer = await prompt(
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
    toast.success(`已导出 ${result.includedEntries.length} 项 / ${formatBytes(result.bytes)}${result.encrypted ? '（已加密）' : ''}${omitted}`)
  } catch (error) {
    toast.error((error as Error).message || '导出备份失败')
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
      const answer = await prompt('该备份包已加密，请输入口令', '恢复备份', {
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
      toast.error('无法读取备份包内容')
      return
    }
    if (!inspected.checksumOk) {
      toast.error('备份包校验失败（内容与清单不一致），已中止恢复')
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

    await confirm(lines.join('\n'), '恢复备份', {
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
    await alert(summary.join('\n'), '恢复完成', { confirmButtonText: '知道了' })
    await Promise.all([loadInfo(), loadAssetsInfo(), loadUsage()])
    if (report.touchedSession) toast.info('会话数据已更新，重启应用后生效')
  } catch (error) {
    // 用户取消（prompt / confirm 抛 cancel）不当作错误
    const message = (error as Error)?.message ?? ''
    if (message && !/cancel|close/i.test(message)) toast.error(message || '恢复备份失败')
  } finally {
    backupBusy.value = false
  }
}

async function loadUsage() {
  usageLoading.value = true
  try {
    usage.value = await invokeAppIpc<DataUsage>(appIpcChannels().DATA_USAGE_GET)
  } catch (error) {
    toast.error((error as Error).message || '计算空间占用失败')
  } finally {
    usageLoading.value = false
  }
}

async function openDirectory() {
  try {
    await invokeAppIpc(appIpcChannels().DATA_DIRECTORY_OPEN)
  } catch (error) {
    toast.error((error as Error).message || '打开文件夹失败')
  }
}

async function selectDirectory() {
  let directory: string | null = null
  try {
    directory = await invokeAppIpc<string | null>(appIpcChannels().DATA_DIRECTORY_SELECT)
  } catch (error) {
    toast.error((error as Error).message || '选择目录失败')
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
      toast.success('已记录新的数据目录；重启应用后会整体迁移并生效')
    } else {
      toast.info('目录未发生变化')
    }
  } catch (error) {
    toast.error((error as Error).message || '更改数据目录失败')
  } finally {
    changing.value = false
  }
}

async function clearCache() {
  try {
    await confirm(
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
      toast.warning(`已释放 ${formatBytes(result.freedBytes)}，${result.skippedDirs} 个目录被占用或跳过`)
    } else if (result.cleanedDirs > 0) {
      toast.success(`已释放 ${formatBytes(result.freedBytes)}`)
    } else {
      toast.info('没有可清理的缓存')
    }
    loadUsage()
  } catch (error) {
    toast.error((error as Error).message || '清除缓存失败')
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
    toast.error((error as Error).message || '打开调试控制台失败')
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

// 设置页只作为当前活动页签挂载；每次重新进入都重新拉取主进程状态，
// 页内操作完成后再按需刷新对应数据。
onMounted(() => {
  void loadInfo()
  void loadAssetsInfo()
  void loadUsage()
  void loadAppearance()
  void loadBounds()
  void nextTick(updateActiveSetting)
})
</script>

<template>
  <div ref="pageRef" class="settings-page tool-page" @scroll.passive="updateActiveSetting">
    <div class="settings-shell">
      <nav class="settings-index" aria-label="设置分区">
        <div v-for="group in SETTINGS_NAV" :key="group.group" class="index-group">
          <div class="index-label">
            {{ group.group }}
          </div>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="index-item"
            :class="{ 'is-active': activeSetting === item.id }"
            :aria-current="activeSetting === item.id ? 'location' : undefined"
            @click="scrollToSetting(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
      </nav>

      <div class="settings-doc">
        <section class="settings-section" aria-labelledby="settings-storage-title">
          <header class="section-head">
            <h2 id="settings-storage-title">
              数据与存储
            </h2>
            <p>数据落地位置、空间占用与迁移备份。</p>
          </header>

          <UiPanel class="settings-group" variant="outlined" padding="0">
            <div class="setting-row" data-setting="data-directory">
              <div class="row-head">
                <div class="row-copy">
                  <h3>数据目录</h3>
                  <p>配置、登录会话与可再生的缓存都存放在这里。</p>
                </div>
                <UiChip v-if="info">
                  {{ info.isCustom ? '自定义' : '默认' }}
                </UiChip>
              </div>
              <div class="path-box">
                <span class="path mono">{{ info?.dataDirectory ?? '—' }}</span>
              </div>
              <div v-if="info?.pendingDataDirectory" class="path-box is-pending">
                <span class="pending-label">待切换</span>
                <span class="path mono">{{ info.pendingDataDirectory }}</span>
                <UiChip tone="warning">
                  重启后生效
                </UiChip>
              </div>
              <div class="row-foot">
                <UiHint size="xs">
                  更改后重启生效：启动时先整体迁移旧目录，目标目录必须为空。
                </UiHint>
                <UiGroup>
                  <UiButton size="small" @click="openDirectory">
                    打开文件夹
                  </UiButton>
                  <UiButton size="small" :loading="changing" @click="selectDirectory">
                    更改…
                  </UiButton>
                </UiGroup>
              </div>
            </div>

            <div class="setting-row" data-setting="data-layers">
              <div class="row-head">
                <div class="row-copy">
                  <h3>数据分层</h3>
                  <p>配置与资产不可再生，会话是登录态，缓存随时可删。</p>
                </div>
                <UiButton link size="small" :disabled="usageLoading" @click="loadUsage">
                  刷新
                </UiButton>
              </div>
              <div v-if="usage" class="usage-block">
                <p class="usage-line">
                  总计 <span class="mono">{{ formatBytes(usage.totalBytes) }}</span>
                  <span class="usage-sep">·</span>
                  可清理 <span class="mono">{{ formatBytes(usage.cleanableBytes) }}</span>
                </p>
                <div class="usage-meter" role="img" :aria-label="`可清理占总量的 ${cleanablePercent}%`">
                  <span class="usage-meter-fill" :style="{ width: `${cleanablePercent}%` }" />
                </div>
              </div>
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
                      归档体量大且不可再生，可放到另一块盘；下次启动会整体迁移，非空目录不覆盖。
                    </p>
                    <UiGroup>
                      <UiButton size="small" @click="openAssetsDirectory">
                        打开
                      </UiButton>
                      <UiButton size="small" :loading="assetsChanging" @click="selectAssetsDirectory">
                        更改…
                      </UiButton>
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
              <UiHint v-else-if="!usage" block>
                空间占用读取失败，点击右上角「刷新」重试。
              </UiHint>
            </div>

            <div class="setting-row" data-setting="cache">
              <div class="row-head">
                <div class="row-copy">
                  <h3>清理缓存</h3>
                  <p>只清缓存层与会话内的浏览器缓存；账号、规则、证书与归档不受影响。</p>
                </div>
                <UiButton size="small" :loading="cleaning" @click="clearCache">
                  清除缓存
                </UiButton>
              </div>
            </div>

            <div class="setting-row" data-setting="backup">
              <div class="row-head">
                <div class="row-copy">
                  <h3>备份与恢复</h3>
                  <p>只打包配置层与资产清单，缓存不进包；恢复前会自动快照现有配置。</p>
                </div>
                <UiGroup>
                  <UiButton size="small" :loading="backupBusy" @click="exportBackup">
                    导出备份…
                  </UiButton>
                  <UiButton size="small" :loading="backupBusy" @click="restoreBackup">
                    从备份恢复…
                  </UiButton>
                </UiGroup>
              </div>
            </div>
          </UiPanel>
        </section>

        <section class="settings-section" aria-labelledby="settings-window-title">
          <header class="section-head">
            <h2 id="settings-window-title">
              窗口
            </h2>
            <p>外观材质、半透明与窗口几何。</p>
          </header>

          <UiPanel class="settings-group" variant="outlined" padding="0">
            <div class="setting-row" data-setting="appearance">
              <div class="row-head">
                <div class="row-copy">
                  <h3>窗口外观</h3>
                  <p>{{ appearanceHint || '调整窗口透明度与系统背景材质。' }}</p>
                </div>
                <UiSwitchField
                  aria-label="半透明窗口"
                  :model-value="transparentOn"
                  :disabled="!isTransparentEnabled"
                  @update:model-value="toggleTransparent"
                />
              </div>

              <div v-if="isTransparentEnabled && appearance?.enabled" class="material-block">
                <div class="block-label">
                  系统材质
                </div>
                <div v-if="materialChoices.length > 0" class="material-options">
                  <button
                    v-for="option in materialChoices"
                    :key="option.value"
                    type="button"
                    class="material-option"
                    :class="{ 'is-active': selectedMaterial === option.value }"
                    :aria-pressed="selectedMaterial === option.value"
                    @click="chooseMaterial(option.value)"
                  >
                    <span class="material-mark" aria-hidden="true" />
                    <span class="material-text">
                      <span class="material-name">{{ option.label }}</span>
                      <span class="material-desc">{{ option.description }}</span>
                    </span>
                  </button>
                </div>
                <UiHint v-else block>
                  当前系统没有可用的系统背景材质，仅窗口画布会透出桌面。
                </UiHint>
              </div>

              <div class="sub-row">
                <div class="row-copy">
                  <h3>夜色玻璃</h3>
                  <p>暗色表面基调 + 亮蓝强调，可与任意半透明 / 材质模式组合；跟随系统「降低透明度」自动退回不透明。</p>
                </div>
                <UiSwitchField
                  aria-label="夜色玻璃"
                  :model-value="nightOn"
                  @update:model-value="toggleNight"
                />
              </div>
            </div>

            <div class="setting-row" data-setting="bounds">
              <div class="row-head">
                <div class="row-copy">
                  <h3>窗口大小与位置</h3>
                  <p>启动时恢复上次退出前的尺寸与位置；记录越界时回到默认尺寸并居中。</p>
                </div>
                <UiSwitchField
                  aria-label="记住窗口大小与位置"
                  :model-value="rememberBoundsOn"
                  @update:model-value="toggleRememberBounds"
                />
              </div>
              <div class="row-foot">
                <span class="bounds-value">
                  <span class="muted">上次记录</span>
                  <span v-if="bounds?.bounds" class="mono">
                    {{ bounds.bounds.width }} × {{ bounds.bounds.height }}{{ bounds.maximized ? '（最大化）' : '' }}
                  </span>
                  <span v-else class="muted">暂无记录，按默认尺寸居中</span>
                </span>
                <UiButton size="small" :loading="boundsResetting" @click="resetBounds">
                  重置为默认大小
                </UiButton>
              </div>
            </div>
          </UiPanel>
        </section>

        <section class="settings-section" aria-labelledby="settings-advanced-title">
          <header class="section-head">
            <h2 id="settings-advanced-title">
              高级
            </h2>
            <p>排查问题时使用，日常无需改动。</p>
          </header>

          <UiPanel class="settings-group" variant="outlined" padding="0">
            <div class="setting-row" data-setting="debug">
              <div class="row-head">
                <div class="row-copy">
                  <h3>调试控制台</h3>
                  <p>在独立窗口中打开 DevTools，关闭该窗口即可收起。</p>
                </div>
                <UiButton size="small" @click="openDevTools">
                  打开调试控制台
                </UiButton>
              </div>
            </div>
          </UiPanel>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
/* 设置工作台：左侧分区索引定高不动，右侧是唯一的滚动文档列。 */
.settings-page {
  padding: 36px 40px 48px;
}

.settings-shell {
  display: grid;
  grid-template-columns: 196px minmax(0, var(--column-document));
  gap: 48px;
  width: min(100%, 1004px);
  margin: 0 auto;
  align-items: start;
}

.settings-index {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  align-self: start;
}

.index-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.index-label {
  padding: 0 10px 6px;
  color: var(--color-text-tertiary);
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.08em;
}

.index-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    color: var(--color-text-primary);
  }

  &.is-active {
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);

    &::before {
      position: absolute;
      top: 7px;
      bottom: 7px;
      left: -8px;
      width: 2px;
      border-radius: 2px;
      background: var(--color-primary);
      content: '';
    }
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.settings-doc {
  min-width: 0;
}

.settings-section + .settings-section {
  margin-top: 44px;
}

.section-head {
  margin-bottom: 14px;

  h2 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-medium);
    letter-spacing: -0.01em;
  }

  p {
    margin: 4px 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.45;
  }
}

.settings-group {
  overflow: hidden;
}

.setting-row {
  padding: 18px 20px;
  /* 索引跳转落点：给分组标题留出位置，避免首行顶到滚动区上沿后标题被裁掉 */
  scroll-margin-top: 84px;

  & + .setting-row {
    border-top: 1px solid var(--color-border-light);
  }
}

.row-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.row-copy {
  min-width: 0;

  h3 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
  }

  p {
    max-width: 56ch;
    margin: 3px 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.45;
  }
}

.row-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;

  .ui-hint {
    flex: 1;
    min-width: 0;
  }
}

.sub-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light);
}

.path-box {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  background: var(--color-well);

  &.is-pending {
    background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  }
}

.path {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  word-break: break-all;
}

.pending-label {
  flex: none;
  color: var(--color-warning);
  font-size: var(--font-size-xs);
}

.bounds-value {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
}

.material-block {
  margin-top: 16px;
}

.block-label {
  margin-bottom: 8px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.material-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}

/* 材质是单选而不是卡片：整行可点，选中只改底色与圆点，不再套一层边框。 */
.material-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }

  &.is-active {
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.material-mark {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border: 1.5px solid var(--color-border);
  border-radius: 50%;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);

  .material-option.is-active & {
    border-color: var(--color-primary);
    background: var(--color-primary);
    box-shadow: inset 0 0 0 3px var(--color-raised);
  }
}

.material-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.material-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.material-desc {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.usage-block {
  margin-top: 12px;
}

.usage-line {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  .mono {
    color: var(--color-text-primary);
  }
}

.usage-sep {
  margin: 0 6px;
  color: var(--color-text-tertiary);
}

.usage-meter {
  height: 3px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-fill);
}

.usage-meter-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width var(--transition-fast);
}

/* 数据分层：一层一行（名称 + 可再生标记 + 体积），条目明细折叠在 details 里。
   用列表而不是表格——层数固定为 4，表格的表头反而占地方。 */
.layer-list {
  margin: 14px 0 0;
  padding: 0;
  border-top: 1px solid var(--color-border-light);
  list-style: none;
}

.layer-row {
  padding: 12px 0;
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

@media (max-width: 980px) {
  .settings-shell {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }

  .settings-index {
    position: static;
    flex-direction: row;
    gap: 8px;
    padding-bottom: 6px;
    overflow-x: auto;
  }

  .index-group {
    flex-direction: row;
    gap: 4px;
  }

  .index-label {
    display: none;
  }

  .index-item {
    flex: none;
    height: 28px;
    padding: 0 11px;
    border: 1px solid var(--color-border-light);
    border-radius: 999px;

    &.is-active::before {
      display: none;
    }
  }
}

@media (max-width: 640px) {
  .settings-page {
    padding: 24px 16px 40px;
  }

  .row-head {
    flex-direction: column;
    gap: 12px;
  }

  .row-foot {
    flex-direction: column;
    align-items: flex-start;
  }

  .material-options {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
