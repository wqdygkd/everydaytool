<script setup lang="ts">
import type { IdCardResult } from '../shared/generator'
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

/* 地区级联：省 / 市 / 区三联下拉（同一份 AREA_TREE，areaPrefixFromPath 语义不变）。 */
const province = computed({
  get: () => String(areaPath.value?.[0] ?? ''),
  set: (v: string) => {
    areaPath.value = v ? [v] : null
  },
})
const city = computed({
  get: () => String(areaPath.value?.[1] ?? ''),
  set: (v: string) => {
    areaPath.value = v ? [province.value, v] : [province.value]
  },
})
const county = computed({
  get: () => String(areaPath.value?.[2] ?? ''),
  set: (v: string) => {
    areaPath.value = v ? [province.value, city.value, v] : [province.value, city.value]
  },
})
const provinceNodes = computed(() => areaOptions)
const cityNodes = computed(() => provinceNodes.value.find(n => n.value === province.value)?.children ?? [])
const countyNodes = computed(() => cityNodes.value.find(n => n.value === city.value)?.children ?? [])

/* 日期范围：两个原生 date 输入（本地时区互转）。 */
function toDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
const dateStart = computed({
  get: () => dateRange.value ? toDateInput(dateRange.value[0]) : '',
  set: (v: string) => {
    if (!v) {
      dateRange.value = null
      return
    }
    const [y, m, d] = v.split('-').map(Number)
    const end = dateRange.value?.[1] ?? new Date(y, m - 1, d)
    dateRange.value = [new Date(y, m - 1, d), end]
  },
})
const dateEnd = computed({
  get: () => dateRange.value ? toDateInput(dateRange.value[1]) : '',
  set: (v: string) => {
    if (!v) {
      dateRange.value = null
      return
    }
    const [y, m, d] = v.split('-').map(Number)
    const start = dateRange.value?.[0] ?? new Date(y, m - 1, d)
    dateRange.value = [start, new Date(y, m - 1, d)]
  },
})

function clampCount() {
  count.value = Math.min(20, Math.max(1, Math.round(Number(count.value) || 1)))
}

const results = ref<IdCardResult[]>([])

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
}

async function handleCopyAll() {
  if (results.value.length > 0) {
    await useCopy(results.value.map(r => r.id).join('\n'), `${results.value.length} 条身份证号`)
  }
}

async function handleCopyId(id: string) {
  await useCopy(id, '身份证号')
}

onMounted(handleGenerate)
</script>

<template>
  <div class="id-card-page tool-page">
    <UiPanel class="generator-card" padding="">
      <div class="config-form">
        <UiFormField label="出生方式">
          <UiRadioGroup v-model="birthMode">
            <UiRadio value="age">
              按年龄
            </UiRadio>
            <UiRadio value="date">
              按出生日期
            </UiRadio>
          </UiRadioGroup>
        </UiFormField>

        <UiFormField v-if="birthMode === 'age'" label="年龄范围">
          <UiSlider v-model="ageRange" :min="1" :max="100" />
        </UiFormField>

        <UiFormField v-else label="出生日期">
          <div class="form-fill date-range">
            <input v-model="dateStart" type="date" class="ui-date-input">
            <span class="muted">至</span>
            <input v-model="dateEnd" type="date" class="ui-date-input">
          </div>
        </UiFormField>

        <UiFormField label="性别">
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

        <UiFormField label="地区">
          <div class="form-fill area-cascade">
            <select v-model="province" class="ui-select">
              <option value="">
                随机全国
              </option>
              <option v-for="node in provinceNodes" :key="node.value" :value="node.value">
                {{ node.label }}
              </option>
            </select>
            <select v-if="province" v-model="city" class="ui-select">
              <option value="">
                全省
              </option>
              <option v-for="node in cityNodes" :key="node.value" :value="node.value">
                {{ node.label }}
              </option>
            </select>
            <select v-if="city" v-model="county" class="ui-select">
              <option value="">
                全市
              </option>
              <option v-for="node in countyNodes" :key="node.value" :value="node.value">
                {{ node.label }}
              </option>
            </select>
          </div>
        </UiFormField>

        <UiFormField label="生成数量">
          <input v-model="count" type="number" class="ui-number-input" min="1" max="20" step="1" @change="clampCount">
        </UiFormField>
      </div>

      <UiGroup class="actions" gap="sm">
        <UiButton type="primary" @click="handleGenerate">
          生成
        </UiButton>
        <UiButton :disabled="results.length === 0" @click="handleCopyAll">
          复制全部
        </UiButton>
      </UiGroup>

      <UiPanel v-if="results.length > 0" variant="outlined" padding="18px" class="result-section">
        <div class="result-header">
          <span class="muted">共 {{ results.length }} 条</span>
        </div>
        <UiTable :data="results" max-height="340" mono>
          <UiTableColumn label="身份证号" min-width="200">
            <template #default="{ row }">
              <span class="id-cell mono" @click="handleCopyId(row.id)">
                {{ row.id }}
              </span>
            </template>
          </UiTableColumn>
          <UiTableColumn prop="areaName" label="地区" min-width="140" />
          <UiTableColumn prop="birthDateDisplay" label="出生日期" width="110" />
          <UiTableColumn prop="genderLabel" label="性别" width="70" />
          <UiTableColumn label="操作" width="70" align="center">
            <template #default="{ row }">
              <UiButton link type="primary" size="small" @click="handleCopyId(row.id)">
                复制
              </UiButton>
            </template>
          </UiTableColumn>
        </UiTable>
      </UiPanel>

      <UiHint size="xs" align="center">
        仅供测试/开发用途，生成的号码为虚构数据，不代表真实身份。
      </UiHint>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
/* 级联 / 日期 / 数量输入:与全站输入框同一套令牌 */
.ui-select,
.ui-date-input,
.ui-number-input {
  height: var(--control-height);
  min-width: 0;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary) inset;
  }
}

.date-range,
.area-cascade {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.area-cascade .ui-select {
  flex: 1;
}

.ui-date-input {
  flex: 1;
}

.ui-number-input {
  width: 120px;
}

/* 表单内选择类控件统一撑满。 */
.form-fill {
  width: 100%;
}

.id-card-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  /* 与设置页 / 离线包 / WXP 同一套页面留白（2xl 顶部、3xl 其余），
     切页签时卡片不会上下跳 8px */
  padding: var(--spacing-2xl) var(--spacing-3xl) var(--spacing-3xl);
  overflow: auto;
}

/* 不投影：本页画布已透明（与主页一致），主卡片靠自身浅底 + 大圆角分层即可。
   面板组件的 shadow prop 只有 sm / md 两档，没有「无」，故在此覆写。 */
.generator-card {
  width: 100%;
  max-width: 720px;
  padding: var(--spacing-2xl);
  box-shadow: none;

  .config-form {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
    margin-bottom: var(--spacing-lg);
  }

  .actions {
    margin-bottom: var(--spacing-xl);
  }

  .result-section {
    margin-bottom: var(--spacing-lg);
  }

  .result-header {
    margin-bottom: var(--spacing-sm);
    font-size: var(--font-size-sm);
  }

  .id-cell {
    cursor: pointer;

    &:hover {
      /* 可点文字取墨档蓝：亮档 3.31:1 在 12px 上读不清 */
      color: var(--color-primary-strong);
      text-decoration: underline;
    }
  }
}

@media (max-width: 640px) {
  .id-card-page {
    padding: var(--spacing-lg);
  }

  .generator-card {
    padding: var(--spacing-xl);

    .actions {
      flex-direction: column;
    }
  }
}
</style>
