<script setup lang="ts">
import type { IconName } from '../shared/components/ui/icons'
import { toast } from 'vue-sonner'
// 组件预览页（仅本地开发访问 /ui-kit）：平台组件库每个组件的最小可交互示例，
// 用途是调样式 / 验证视觉回归，不承载业务。
import { icons } from '../shared/components/ui/icons'
import { alert, confirm, prompt } from '../shared/feedback'

const anchors = [
  { value: 'input', label: '输入' },
  { value: 'layout', label: '布局' },
  { value: 'data', label: '数据展示' },
  { value: 'badge', label: '徽章状态' },
  { value: 'form', label: '表单输入' },
  { value: 'action', label: '按钮图标' },
  { value: 'feedback', label: '反馈弹层' },
]
const anchor = ref('layout')

function scrollToAnchor(value: string) {
  anchor.value = value
  document.getElementById(`showcase-${value}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const iconNames = Object.keys(icons) as IconName[]

const menuValue = ref('all')
const menuItems = [
  { value: 'all', label: '全部', badge: 12 },
  { value: 'running', label: '运行中', badge: 2 },
  { value: 'stopped', label: '已停止' },
]

const tableData = [
  { id: 1, name: 'interceptor', status: '运行中', tone: 'success' as const, size: '12.4 MB' },
  { id: 2, name: 'offline-pack', status: '已停止', tone: 'neutral' as const, size: '3.1 MB' },
  { id: 3, name: 'treease-editor', status: '警告', tone: 'warning' as const, size: '48.7 MB' },
]

const breadcrumbItems = [
  { label: '工具' },
  { label: '缓存管理' },
  { label: '详情' },
]

const chipTones = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const
const chipVariants = ['soft', 'outline', 'solid'] as const

const inputValue = ref('')
const searchPill = ref('')
const searchBox = ref('')
const pathValue = ref('D:\\project\\everydaytool\\data\\config')
const selectValue = ref('')
const selectOptions = [
  { label: '选项一', value: 'a' },
  { label: '选项二', value: 'b' },
  { label: '选项三', value: 'c' },
]
const checkboxOn = ref(true)
const checkboxIndeterminate = ref(true)
const radioValue = ref('a')
const sliderValue = ref(40)
const sliderRange = ref([20, 70])
const switchOn = ref(true)
const switchOff = ref(false)
const codeAreaValue = ref('{"enabled": true}')

const collapseOpen = ref<Array<string | number>>(['c1'])
const listActive = ref(1)

const dialogOpen = ref(false)
const msgboxOpen = ref(false)
const popoverVisible = ref(false)

const dropdownItems: Array<{ command: string, label: string, icon?: IconName, danger?: boolean }> = [
  { command: 'rename', label: '重命名', icon: 'pencil' },
  { command: 'copy', label: '复制路径', icon: 'copy' },
  { command: 'remove', label: '删除', icon: 'close', danger: true },
]

async function demoConfirm() {
  try {
    await confirm('确定要执行该操作吗？此操作不可撤销。', '操作确认', { type: 'warning' })
    toast.success('已确认')
  } catch {
    toast.info('已取消')
  }
}

async function demoAlertBox() {
  try {
    await alert('这是一条普通提示，点击确定关闭。', '提示')
  } catch { /* 取消不提示 */ }
}

async function demoPrompt() {
  try {
    const { value } = await prompt('请输入模块名称', '输入', { inputPlaceholder: '必填' })
    toast.success(`输入了：${value}`)
  } catch {
    toast.info('已取消')
  }
}

function notify(message: string) {
  toast(message)
}
</script>

<template>
  <div class="ui-showcase">
    <!-- 顶部锚点导航本身就是 UiMenuHorizontal 的活示例 -->
    <nav class="ui-showcase-nav">
      <UiMenuHorizontal
        :model-value="anchor"
        :items="anchors"
        @update:model-value="scrollToAnchor"
      />
    </nav>

    <section id="showcase-input" class="ui-showcase-section">
      <UiSectionHeader title="输入" :count="1" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiInput / UiFormField" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiFormField label="普通输入" label-width="72px">
              <UiInput v-model="inputValue" placeholder="默认尺寸" />
            </UiFormField>
            <UiFormField label="small" label-width="72px">
              <UiInput v-model="inputValue" size="small" placeholder="24px 高" />
            </UiFormField>
            <UiFormField label="禁用" label-width="72px">
              <UiInput model-value="不可编辑" disabled />
            </UiFormField>
          </UiGroup>
        </UiPanel>
      </div>
    </section>

    <section id="showcase-layout" class="ui-showcase-section">
      <UiSectionHeader title="布局" :count="7" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiPanel（raised / outlined / titleSize）" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiGroup gap="md">
              <UiPanel title="raised 浮岛" shadow="sm" padding="var(--spacing-md)" />
              <UiPanel title="outlined 描边" variant="outlined" padding="var(--spacing-md)" />
              <UiPanel title="lg 标题" title-size="lg" padding="var(--spacing-md)" />
            </UiGroup>
            <UiPanel variant="outlined" padding="var(--spacing-md)">
              <template #title>
                #title 插槽 + #actions
              </template>
              <template #actions>
                <UiIconButton icon="pencil" label="编辑" :size="26" />
              </template>
            </UiPanel>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiGroup / UiToolbar" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiGroup gap="sm" wrap>
              <UiChip tone="primary" variant="soft">
                UiGroup row
              </UiChip>
              <UiButton size="small">
                按钮
              </UiButton>
              <UiButton size="small" type="primary">
                按钮
              </UiButton>
            </UiGroup>
            <UiGroup direction="column" gap="xs">
              <UiChip tone="info" variant="soft">
                UiGroup column
              </UiChip>
              <UiHint>direction="column" + gap 阶梯</UiHint>
            </UiGroup>
            <UiToolbar bordered>
              <UiIconButton icon="plus" label="新增" />
              <UiIconButton icon="pin" label="固定" />
              <UiButton size="small" type="primary">
                工具条动作
              </UiButton>
              <template #end>
                <UiIconButton icon="more" label="更多" />
              </template>
            </UiToolbar>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiSectionHeader / UiMenuHorizontal" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiSectionHeader title="区块标题" :count="3">
              <template #actions>
                <UiButton size="small" text>
                  管理
                </UiButton>
              </template>
            </UiSectionHeader>
            <UiMenuHorizontal v-model="menuValue" :items="menuItems" />
            <UiHint>当前选中：{{ menuValue }}</UiHint>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiListCard" variant="outlined">
          <UiGroup direction="column" gap="xs">
            <UiListCard
              v-for="i in 3"
              :key="i"
              :active="listActive === i"
              @click="listActive = i"
            >
              列表卡 {{ i }}
            </UiListCard>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiDetailGrid / UiDetailItem" variant="outlined">
          <UiDetailGrid :columns="2">
            <UiDetailItem label="名称" mono>
              everydaytool
            </UiDetailItem>
            <UiDetailItem label="版本">
              1.0.0
            </UiDetailItem>
            <UiDetailItem label="长路径" mono wrap>
              D:\project\everydaytool\data\config\app\window-appearance.json
            </UiDetailItem>
            <UiDetailItem label="尺寸" size="xs">
              xs 档
            </UiDetailItem>
          </UiDetailGrid>
        </UiPanel>

        <UiPanel title="UiBreadcrumb" variant="outlined">
          <UiBreadcrumb
            :items="breadcrumbItems"
            @navigate="i => notify(`导航到第 ${i + 1} 级`)"
          />
        </UiPanel>
      </div>
    </section>

    <section id="showcase-data" class="ui-showcase-section">
      <UiSectionHeader title="数据展示" :count="5" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiTable + UiTableColumn" variant="outlined">
          <UiTable :data="tableData" row-key="id" max-height="240">
            <UiTableColumn prop="id" label="ID" width="60" />
            <UiTableColumn prop="name" label="模块" min-width="140" sortable="custom" show-overflow-tooltip />
            <UiTableColumn prop="size" label="体积" width="100" align="right" />
            <UiTableColumn label="状态" width="110">
              <template #default="{ row }">
                <UiChip :tone="row.tone" variant="soft">
                  {{ row.status }}
                </UiChip>
              </template>
            </UiTableColumn>
          </UiTable>
        </UiPanel>

        <UiPanel title="UiKeyValue" variant="outlined">
          <UiGroup direction="column">
            <UiKeyValue label="数据目录" mono label-width="80px">
              &lt;data&gt;/config/app
            </UiKeyValue>
            <UiKeyValue label="缓存" label-width="80px" muted>
              128.4 MB
            </UiKeyValue>
            <UiKeyValue label="路径" mono label-width="80px" wrap>
              D:\project\everydaytool\data\cache\telegram-cache
              <template #actions>
                <UiCopyButton text="D:\\project\\everydaytool" label="路径" />
              </template>
            </UiKeyValue>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiProgress / UiCodeBlock" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiProgress :percentage="68" />
            <UiProgress :percentage="45" status="success" show-text />
            <UiProgress :percentage="30" status="warning" />
            <UiProgress :percentage="12" status="exception" />
            <UiCode-block max-height="120px">
              {{ JSON.stringify({ name: 'edt', layers: ['config', 'assets', 'session', 'cache'] }, null, 2) }}
            </UiCode-block>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiEmpty" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiEmpty text="plain：无框纯文本空态" />
            <UiEmpty
              variant="bordered"
              center
              icon="search"
              title="没有找到匹配的规则"
            >
              <template #actions>
                <UiButton size="small" type="primary">
                  新建规则
                </UiButton>
              </template>
            </UiEmpty>
          </UiGroup>
        </UiPanel>
      </div>
    </section>

    <section id="showcase-badge" class="ui-showcase-section">
      <UiSectionHeader title="徽章状态" :count="2" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiChip（6 tone × auto / soft / outline / solid）" variant="outlined">
          <UiGroup direction="column" gap="sm">
            <UiGroup v-for="variant in ['auto', ...chipVariants]" :key="variant" gap="sm" wrap>
              <UiChip
                v-for="tone in chipTones"
                :key="`${variant}-${tone}`"
                :tone="tone"
                :variant="variant"
              >
                {{ tone }}
              </UiChip>
            </UiGroup>
          </UiGroup>
        </UiPanel>
        <UiPanel title="UiStatusTag" variant="outlined">
          <UiGroup gap="lg">
            <span class="status-demo"><UiStatusTag tone="neutral" /> neutral</span>
            <span class="status-demo"><UiStatusTag tone="success" /> success</span>
            <span class="status-demo"><UiStatusTag tone="warning" /> warning</span>
            <span class="status-demo"><UiStatusTag tone="danger" /> danger</span>
            <span class="status-demo"><UiStatusTag tone="success" pulsing /> pulsing</span>
          </UiGroup>
        </UiPanel>
      </div>
    </section>

    <section id="showcase-form" class="ui-showcase-section">
      <UiSectionHeader title="表单输入" :count="8" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiSearchInput（pill / box）" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiSearchInput v-model="searchPill" variant="pill" placeholder="pill 搜索" width="280px" />
            <UiSearchInput v-model="searchBox" variant="box" clearable placeholder="box 搜索" width="240px" />
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiPathField / UiCodeArea" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiPathField v-model="pathValue" mono />
            <UiCodeArea v-model="codeAreaValue" :rows="4" meta="JSON" />
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiSelect" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiSelect v-model="selectValue" :options="selectOptions" placeholder="请选择" />
            <UiSelect model-value="b" :options="selectOptions" size="small" />
            <UiSelect model-value="" :options="selectOptions" disabled placeholder="禁用态" />
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiCheckbox / UiRadioGroup + UiRadio" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiGroup gap="lg" wrap>
              <UiCheckbox v-model="checkboxOn">
                选中
              </UiCheckbox>
              <UiCheckbox :model-value="false">
                未选
              </UiCheckbox>
              <UiCheckbox v-model="checkboxIndeterminate" indeterminate>
                半选
              </UiCheckbox>
              <UiCheckbox :model-value="false" disabled>
                禁用
              </UiCheckbox>
            </UiGroup>
            <UiRadioGroup v-model="radioValue">
              <UiRadio value="a">
                选项 A
              </UiRadio>
              <UiRadio value="b">
                选项 B
              </UiRadio>
              <UiRadio value="c" disabled>
                禁用项
              </UiRadio>
            </UiRadioGroup>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiSlider（单值 / range）" variant="outlined">
          <UiGroup direction="column" gap="lg">
            <div>
              <UiHint>单值：{{ sliderValue }}</UiHint>
              <UiSlider v-model="sliderValue" />
            </div>
            <div>
              <UiHint>range：{{ sliderRange }}</UiHint>
              <UiSlider v-model="sliderRange" />
            </div>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiSwitchField（center / start / disabled）" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiSwitchField v-model="switchOn">
              单行说明（center）
            </UiSwitchField>
            <UiSwitchField v-model="switchOff" align="start">
              多行说明（start）：开关中线对齐首行，后续行自然下排，不会漂到段落中间。
            </UiSwitchField>
            <UiSwitchField :model-value="true" disabled>
              禁用
            </UiSwitchField>
          </UiGroup>
        </UiPanel>
      </div>
    </section>

    <section id="showcase-action" class="ui-showcase-section">
      <UiSectionHeader title="按钮图标" :count="6" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiButton（type / 变体 / 状态）" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiGroup gap="sm" wrap>
              <UiButton type="primary">
                primary
              </UiButton>
              <UiButton>info 默认</UiButton>
              <UiButton type="success">
                success
              </UiButton>
              <UiButton type="warning">
                warning
              </UiButton>
              <UiButton type="danger">
                danger
              </UiButton>
            </UiGroup>
            <UiGroup gap="sm" wrap>
              <UiButton type="primary" plain>
                plain
              </UiButton>
              <UiButton type="danger" plain>
                plain danger
              </UiButton>
              <UiButton text>
                text
              </UiButton>
              <UiButton link type="primary">
                link
              </UiButton>
              <UiButton type="primary" loading>
                loading
              </UiButton>
              <UiButton disabled>
                disabled
              </UiButton>
            </UiGroup>
            <UiGroup gap="sm" wrap>
              <UiButton size="small">
                small
              </UiButton>
              <UiButton size="default">
                default
              </UiButton>
              <UiButton size="large">
                large
              </UiButton>
            </UiGroup>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiIconButton / UiCopyButton" variant="outlined">
          <UiGroup gap="md">
            <UiIconButton icon="pencil" label="编辑" />
            <UiIconButton icon="pin" label="固定" active />
            <UiIconButton icon="close" label="删除" tone="danger" />
            <UiIconButton icon="plus" label="禁用" disabled />
            <UiCopyButton text="everything-tool" label="内容" />
            <UiCopyButton text="everything-tool" label="内容" text-button />
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiIcon（全量图标名表 icons.ts）" variant="outlined">
          <div class="icon-grid">
            <div v-for="name in iconNames" :key="name" class="icon-cell">
              <UiIcon :name="name" :size="20" />
              <span>{{ name }}</span>
            </div>
          </div>
        </UiPanel>

        <UiPanel title="UiAvatar / UiLink" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiGroup gap="md">
              <UiAvatar text="edt" :size="28" />
              <UiAvatar text="everydaytool" />
              <UiAvatar text="tg" color="var(--color-success)" :size="42" />
            </UiGroup>
            <UiGroup gap="lg" wrap>
              <UiLink type="primary" @click="() => notify('primary link')">
                primary
              </UiLink>
              <UiLink type="success">
                success
              </UiLink>
              <UiLink type="warning">
                warning
              </UiLink>
              <UiLink type="danger">
                danger
              </UiLink>
              <UiLink>info 默认</UiLink>
            </UiGroup>
          </UiGroup>
        </UiPanel>
      </div>
    </section>

    <section id="showcase-feedback" class="ui-showcase-section">
      <UiSectionHeader title="反馈弹层" :count="6" />
      <div class="ui-showcase-grid">
        <UiPanel title="UiAlert（4 语义色）" variant="outlined">
          <UiGroup direction="column" gap="sm">
            <UiAlert type="info" title="info 提示" description="品牌蓝浅底，普通信息。" show-icon />
            <UiAlert type="success" title="success 提示" description="操作成功。" show-icon />
            <UiAlert type="warning" title="warning 提示" description="请注意潜在风险。" show-icon />
            <UiAlert type="error" title="error 提示" description="操作失败，请重试。" show-icon />
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiHint" variant="outlined">
          <UiGroup direction="column" gap="sm">
            <UiHint>行内 hint（sm）</UiHint>
            <UiHint size="xs">
              xs hint：更小的说明文字
            </UiHint>
            <UiHint block align="center">
              block + center：块级居中说明
            </UiHint>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiDialog / UiMessageBox / 命令式 confirm / alert / prompt" variant="outlined">
          <UiGroup direction="column" gap="md">
            <UiGroup gap="sm" wrap>
              <UiButton type="primary" @click="dialogOpen = true">
                打开 UiDialog
              </UiButton>
              <UiButton @click="msgboxOpen = true">
                打开 UiMessageBox
              </UiButton>
              <UiButton @click="demoConfirm()">
                confirm()
              </UiButton>
              <UiButton @click="demoAlertBox()">
                alert()
              </UiButton>
              <UiButton @click="demoPrompt()">
                prompt()
              </UiButton>
            </UiGroup>
            <UiHint>命令式入口来自 shared/feedback（全站唯一反馈接触面）</UiHint>

            <UiDialog v-model="dialogOpen" title="UiDialog 示例" width="480">
              <p>模态框内容区（radius-xl + shadow-lg）。</p>
              <template #footer>
                <UiButton @click="dialogOpen = false">
                  取消
                </UiButton>
                <UiButton type="primary" @click="dialogOpen = false">
                  确定
                </UiButton>
              </template>
            </UiDialog>

            <UiMessageBox
              v-model="msgboxOpen"
              title="删除确认"
              message="该操作不可恢复，确定删除？"
              type="warning"
              @confirm="toast.success('已确认删除')"
            />
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiPopover / UiDropdown" variant="outlined">
          <UiGroup gap="sm" wrap>
            <UiPopover v-model:visible="popoverVisible" :width="280">
              <template #trigger>
                <UiButton @click="popoverVisible = !popoverVisible">
                  气泡卡
                </UiButton>
              </template>
              <div style="padding: var(--spacing-md)">
                <UiHint>Popover 内容区（pop 角色表面 + 阴影）</UiHint>
              </div>
            </UiPopover>
            <UiDropdown
              :items="dropdownItems"
              @command="c => notify(`command: ${c}`)"
            >
              <template #trigger>
                <UiButton>下拉菜单</UiButton>
              </template>
            </UiDropdown>
          </UiGroup>
        </UiPanel>

        <UiPanel title="UiCollapse + UiCollapseItem" variant="outlined">
          <UiCollapse v-model="collapseOpen">
            <UiCollapseItem name="c1" title="第一组">
              <UiHint>受控多开：modelValue 为展开的 name 数组。</UiHint>
            </UiCollapseItem>
            <UiCollapseItem name="c2" title="第二组">
              <UiHint>header 支持键盘 Enter / Space。</UiHint>
            </UiCollapseItem>
          </UiCollapse>
        </UiPanel>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.ui-showcase {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--spacing-md) var(--spacing-lg) 120px;
  background: var(--color-app-bg);
  min-height: 100%;
}

.ui-showcase-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  margin: calc(-1 * var(--spacing-md)) calc(-1 * var(--spacing-lg)) 0;
  padding: var(--spacing-sm) var(--spacing-lg) 0;
  background: var(--color-app-bg);
}

.ui-showcase-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  scroll-margin-top: 72px;
}

/* 预览网格：两列自适应，窄屏折单列 */
.ui-showcase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: var(--spacing-md);
  align-items: start;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: var(--spacing-sm);
}

.icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.status-demo {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
