<script setup lang="ts">
import type { IdCardResult } from '../shared/generator'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { AREA_TREE, areaPrefixFromPath } from '../shared/area-hierarchy'
import { GENDER, generateIdCards } from '../shared/generator'

const birthMode = ref<'age' | 'date'>('age')
const gender = ref(GENDER.RANDOM)
const ageRange = ref([18, 60])
const dateRange = ref<[Date, Date] | null>(null)
const areaPath = ref<Array<string | number> | null>(null)
const count = ref(1)

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
    <UiPanel class="generator-card" shadow="md" padding="">
      <el-form label-width="80px" class="config-form">
        <el-form-item label="出生方式">
          <el-radio-group v-model="birthMode">
            <el-radio value="age">
              按年龄
            </el-radio>
            <el-radio value="date">
              按出生日期
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="birthMode === 'age'" label="年龄范围">
          <el-slider v-model="ageRange" range :min="1" :max="100" />
        </el-form-item>

        <el-form-item v-else label="出生日期">
          <el-date-picker
            v-model="dateRange"
            class="form-fill"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
        </el-form-item>

        <el-form-item label="性别">
          <el-radio-group v-model="gender">
            <el-radio :value="GENDER.MALE">
              男
            </el-radio>
            <el-radio :value="GENDER.FEMALE">
              女
            </el-radio>
            <el-radio :value="GENDER.RANDOM">
              随机
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="地区">
          <el-cascader
            v-model="areaPath"
            class="form-fill"
            :options="AREA_TREE"
            :props="{ expandTrigger: 'hover' }"
            clearable
            placeholder="随机全国"
          />
        </el-form-item>

        <el-form-item label="生成数量">
          <el-input-number v-model="count" :min="1" :max="20" :step="1" />
        </el-form-item>
      </el-form>

      <UiGroup class="actions" gap="sm">
        <el-button type="primary" @click="handleGenerate">
          生成
        </el-button>
        <el-button :disabled="results.length === 0" @click="handleCopyAll">
          复制全部
        </el-button>
      </UiGroup>

      <UiPanel v-if="results.length > 0" variant="outlined" padding="18px" class="result-section">
        <div class="result-header">
          <span class="muted">共 {{ results.length }} 条</span>
        </div>
        <el-table :data="results" size="small" class="result-table" max-height="340">
          <el-table-column label="身份证号" min-width="200">
            <template #default="{ row }">
              <span class="id-cell mono" @click="handleCopyId(row.id)">
                {{ row.id }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="areaName" label="地区" min-width="140" />
          <el-table-column prop="birthDateDisplay" label="出生日期" width="110" />
          <el-table-column prop="genderLabel" label="性别" width="70" />
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="handleCopyId(row.id)">
                复制
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </UiPanel>

      <UiHint size="xs" align="center">
        仅供测试/开发用途，生成的号码为虚构数据，不代表真实身份。
      </UiHint>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
/* EP 选择类控件默认不满宽（daterange 350px / cascader 自适应）：表单内统一撑满 */
.form-fill {
  width: 100%;
}

.id-card-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--spacing-3xl);
  overflow: auto;
}

.generator-card {
  width: 100%;
  max-width: 720px;
  padding: var(--spacing-2xl);

  .config-form {
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

  .result-table {
    :deep(.el-table__cell) {
      font-family: var(--font-mono);
    }
  }

  .id-cell {
    cursor: pointer;

    &:hover {
      color: var(--color-primary);
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
