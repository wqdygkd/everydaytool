<script setup lang="ts">
import type { IdCardResult } from '../shared/generator'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { AREA_TREE, areaPrefixFromPath } from '../shared/area-hierarchy'
import { GENDER, generateIdCards } from '../shared/generator'

interface AreaNode {
  value: string
  label: string
  children?: AreaNode[]
}

const areaOptions = AREA_TREE as AreaNode[]

const birthMode = ref<'age' | 'date'>('age')
const gender = ref(GENDER.RANDOM)
const ageRange = ref([18, 60])
const dateRange = ref<[Date, Date] | null>(null)
const areaPath = ref<Array<string | number> | null>(null)
const count = ref(1)

const province = computed({
  get: () => String(areaPath.value?.[0] ?? ''),
  set: (value: string) => {
    areaPath.value = value ? [value] : null
  },
})
const city = computed({
  get: () => String(areaPath.value?.[1] ?? ''),
  set: (value: string) => {
    areaPath.value = value ? [province.value, value] : [province.value]
  },
})
const county = computed({
  get: () => String(areaPath.value?.[2] ?? ''),
  set: (value: string) => {
    areaPath.value = value ? [province.value, city.value, value] : [province.value, city.value]
  },
})

const provinceNodes = computed(() => areaOptions)
const cityNodes = computed(() => provinceNodes.value.find(node => node.value === province.value)?.children ?? [])
const countyNodes = computed(() => cityNodes.value.find(node => node.value === city.value)?.children ?? [])

const provinceOptions = computed(() => [
  { label: '随机全国', value: '' },
  ...provinceNodes.value.map(node => ({ label: node.label, value: node.value })),
])
const cityOptions = computed(() => [
  { label: '全省', value: '' },
  ...cityNodes.value.map(node => ({ label: node.label, value: node.value })),
])
const countyOptions = computed(() => [
  { label: '全市', value: '' },
  ...countyNodes.value.map(node => ({ label: node.label, value: node.value })),
])

function toDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

const dateStart = computed({
  get: () => dateRange.value ? toDateInput(dateRange.value[0]) : '',
  set: (value: string) => {
    if (!value) {
      dateRange.value = null
      return
    }
    const [year, month, day] = value.split('-').map(Number)
    const end = dateRange.value?.[1] ?? new Date(year, month - 1, day)
    dateRange.value = [new Date(year, month - 1, day), end]
  },
})
const dateEnd = computed({
  get: () => dateRange.value ? toDateInput(dateRange.value[1]) : '',
  set: (value: string) => {
    if (!value) {
      dateRange.value = null
      return
    }
    const [year, month, day] = value.split('-').map(Number)
    const start = dateRange.value?.[0] ?? new Date(year, month - 1, day)
    dateRange.value = [start, new Date(year, month - 1, day)]
  },
})

function clampCount() {
  count.value = Math.min(20, Math.max(1, Math.round(Number(count.value) || 1)))
}

const results = ref<IdCardResult[]>([])
const selectedId = ref<string | null>(null)

function buildOptions() {
  const areaCode = areaPrefixFromPath(areaPath.value)
  const birthRange = birthMode.value === 'date' && dateRange.value
    ? [dateRange.value[0].getTime(), dateRange.value[1].getTime()] as [number, number]
    : undefined
  return {
    gender: gender.value,
    ageRange: ageRange.value as [number, number],
    birthRange,
    areaCode,
  }
}

function handleGenerate() {
  results.value = generateIdCards(buildOptions(), count.value)
  selectedId.value = results.value[0]?.id ?? null
}

async function handleCopyAll() {
  if (results.value.length > 0)
    await useCopy(results.value.map(result => result.id).join('\n'), `${results.value.length} 条身份证号`)
}

async function handleCopyId(id: string) {
  selectedId.value = id
  await useCopy(id, '身份证号')
}

function rowClassName({ row }: { row: IdCardResult }) {
  return row.id === selectedId.value ? 'is-selected' : ''
}

onMounted(handleGenerate)
</script>

<template>
  <div class="id-card-page tool-page">
    <WorkspaceHeader
      icon="idCard"
      title="身份证号生成器"
      description="按地区、出生范围与性别批量生成虚构号码"
    />

    <ToolSurface class="generator-surface">
      <div class="form-studio">
        <aside class="config-pane">
          <div class="pane-title">
            生成参数
          </div>

          <div class="config-form">
            <UiFormField label="出生方式" label-width="72px">
              <UiRadioGroup v-model="birthMode">
                <UiRadio value="age">
                  按年龄
                </UiRadio>
                <UiRadio value="date">
                  按出生日期
                </UiRadio>
              </UiRadioGroup>
            </UiFormField>

            <UiFormField v-if="birthMode === 'age'" label="年龄范围" label-width="72px">
              <div class="age-range">
                <div class="age-range-values" aria-hidden="true">
                  <span>{{ ageRange[0] }} 岁</span>
                  <span>{{ ageRange[1] }} 岁</span>
                </div>
                <UiSlider v-model="ageRange" :min="1" :max="100" />
              </div>
            </UiFormField>

            <UiFormField v-else label="出生日期" label-width="72px">
              <div class="date-range">
                <input v-model="dateStart" type="date" class="ui-date-input">
                <span class="date-separator">至</span>
                <input v-model="dateEnd" type="date" class="ui-date-input">
              </div>
            </UiFormField>

            <UiFormField label="性别" label-width="72px">
              <UiRadioGroup v-model="gender">
                <UiRadio :value="GENDER.MALE">
                  男
                </UiRadio>
                <UiRadio :value="GENDER.FEMALE">
                  女
                </UiRadio>
                <UiRadio :value="GENDER.RANDOM">
                  随机
                </UiRadio>
              </UiRadioGroup>
            </UiFormField>

            <UiFormField label="地区" label-width="72px">
              <div class="area-cascade">
                <UiSelect v-model="province" :options="provinceOptions" />
                <UiSelect v-if="province" v-model="city" :options="cityOptions" />
                <UiSelect v-if="city" v-model="county" :options="countyOptions" />
              </div>
            </UiFormField>

            <UiFormField label="生成数量" label-width="72px">
              <div class="count-row">
                <input
                  v-model="count"
                  type="number"
                  class="ui-number-input"
                  min="1"
                  max="20"
                  step="1"
                  @change="clampCount"
                >
                <span>最多 20 条</span>
              </div>
            </UiFormField>
          </div>

          <div class="config-actions">
            <UiButton type="primary" @click="handleGenerate">
              生成 {{ count }} 条
            </UiButton>
          </div>

          <UiHint size="xs" align="start" class="legal-hint">
            仅供测试与开发用途。生成号码为虚构数据，不代表真实身份。
          </UiHint>
        </aside>

        <section class="result-pane">
          <header class="result-head">
            <div>
              <strong>生成结果</strong>
              <span>点击号码行即可复制</span>
            </div>
            <div class="result-actions">
              <UiChip tone="neutral">
                {{ results.length }} 条
              </UiChip>
              <UiButton size="small" :disabled="results.length === 0" @click="handleCopyAll">
                复制全部
              </UiButton>
            </div>
          </header>

          <UiTable
            class="result-table"
            :data="results"
            :max-height="320"
            mono
            row-clickable
            :row-class-name="rowClassName"
            empty-text="设置参数后点击“生成”"
            @row-click="row => handleCopyId(row.id)"
          >
            <UiTableColumn label="身份证号" min-width="220">
              <template #default="{ row }">
                <span class="id-cell mono">{{ row.id }}</span>
              </template>
            </UiTableColumn>
            <UiTableColumn prop="areaName" label="地区" min-width="140" />
            <UiTableColumn prop="birthDateDisplay" label="出生日期" width="112" />
            <UiTableColumn prop="genderLabel" label="性别" width="72" />
            <UiTableColumn label="操作" width="70" align="center">
              <template #default="{ row }">
                <UiButton link type="primary" size="small" @click.stop="handleCopyId(row.id)">
                  复制
                </UiButton>
              </template>
            </UiTableColumn>
          </UiTable>
        </section>
      </div>

      <template #statusline>
        <span>LOCAL GENERATOR</span>
        <span v-if="selectedId" class="mono">已选 {{ selectedId }}</span>
        <span class="status-spacer" />
        <span>数据不离开本机</span>
      </template>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.id-card-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 18px 18px;
  overflow: hidden;
}

.generator-surface {
  min-height: 0;
}

.form-studio {
  display: flex;
  flex: 1;
  min-height: 0;
}

.config-pane {
  display: flex;
  flex: 0 0 360px;
  flex-direction: column;
  width: 360px;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid var(--color-border-light);
}

.pane-title {
  margin-bottom: 15px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 17px;
}

.config-actions {
  display: flex;
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border-light);

  .ui-button {
    width: 100%;
  }
}

.date-range,
.area-cascade,
.count-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
}

.age-range {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
}

.age-range-values {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.date-range {
  .ui-date-input {
    flex: 1;
    min-width: 0;
  }
}

.date-separator {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.area-cascade {
  flex-wrap: wrap;

  > * {
    flex: 1 1 100%;
  }
}

.count-row {
  .ui-number-input {
    width: 96px;
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
  }
}

.ui-date-input,
.ui-number-input {
  height: var(--control-height);
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);

  &:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
}

.legal-hint {
  margin-top: auto;
  padding-top: 22px;
}

.result-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  flex: 0 0 48px;
  height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);

  > div {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }

  strong {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
  }
}

.result-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.result-table {
  flex: 0 1 auto;
  margin: 0 var(--spacing-lg) var(--spacing-lg);

  :deep(.ui-table-wrap) {
    border-radius: var(--radius-md);
  }
}

.id-cell {
  color: var(--color-text-primary);
}

.status-spacer {
  flex: 1;
}

@media (max-width: 1180px) {
  .config-pane {
    flex-basis: 320px;
    width: 320px;
  }
}
</style>
