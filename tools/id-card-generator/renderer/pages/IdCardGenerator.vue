<script setup lang="ts">
import { AREA_TREE, areaPrefixFromPath } from '../shared/area-hierarchy'
import { GENDER, generateIdCards } from '../shared/generator'

const birthMode = ref<'age' | 'date'>('age')
const gender = ref(GENDER.RANDOM)
const ageRange = ref([18, 60])
const dateRange = ref<[Date, Date] | null>(null)
const areaPath = ref<Array<string | number> | null>(null)
const count = ref(1)

const results = ref<Array<{ id: string, areaName: string, birthDateDisplay: string, genderLabel: string }>>([])

function buildOptions() {
  const areaCode = areaPrefixFromPath(areaPath.value!)
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
  if (results.value.length === 0) return
  try {
    await navigator.clipboard.writeText(results.value.map(r => r.id).join('\n'))
    ElMessage.success(`已复制 ${results.value.length} 条到剪贴板`)
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

async function handleCopyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    ElMessage.success('已复制该条身份证号')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

onMounted(() => {
  handleGenerate()
})
</script>

<template>
  <div class="id-card-page tool-page">
    <div class="generator-card surface-card">
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
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 100%"
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
            :options="AREA_TREE"
            :props="{ expandTrigger: 'hover' }"
            clearable
            placeholder="随机全国"
            style="width: 100%"
          />
        </el-form-item>

        <el-form-item label="生成数量">
          <el-input-number v-model="count" :min="1" :max="20" :step="1" />
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button type="primary" @click="handleGenerate">
          生成
        </el-button>
        <el-button :disabled="results.length === 0" @click="handleCopyAll">
          复制全部
        </el-button>
      </div>

      <div v-if="results.length > 0" class="result-section">
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
      </div>

      <p class="disclaimer muted">
        仅供测试/开发用途，生成的号码为虚构数据，不代表真实身份。
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.id-card-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px;
  overflow: auto;
}

.generator-card {
  width: 100%;
  max-width: 720px;
  padding: 28px;
  box-shadow: var(--shadow-md);

  .config-form {
    margin-bottom: var(--spacing-lg);
  }

  .actions {
    display: flex;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xl);
  }

  .result-section {
    margin-bottom: var(--spacing-lg);
    padding: 18px;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    background: var(--color-muted);
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

  .disclaimer {
    margin: 0;
    font-size: var(--font-size-xs);
    line-height: 1.5;
    text-align: center;
  }
}

@media (max-width: 640px) {
  .id-card-page {
    padding: 16px;
  }

  .generator-card {
    padding: 20px;

    .actions {
      flex-direction: column;
    }
  }
}
</style>
