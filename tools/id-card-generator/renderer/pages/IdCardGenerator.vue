<template>
  <div class="id-card-page">
    <div class="generator-card">
      <el-form label-width="80px" class="config-form">
        <el-form-item label="性别">
          <el-radio-group v-model="gender">
            <el-radio :value="GENDER.MALE">男</el-radio>
            <el-radio :value="GENDER.FEMALE">女</el-radio>
            <el-radio :value="GENDER.RANDOM">随机</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="年龄范围">
          <el-slider v-model="ageRange" range :min="1" :max="100" />
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button type="primary" @click="handleGenerate">生成</el-button>
        <el-button :disabled="!result" @click="handleCopy">复制</el-button>
      </div>

      <div v-if="result" class="result-section">
        <div class="id-number">{{ result.id }}</div>
        <div class="result-details">
          <div class="detail-item">
            <span class="detail-label">地区</span>
            <span class="detail-value">{{ result.areaName }}（{{ result.areaCode }}）</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">出生日期</span>
            <span class="detail-value">{{ result.birthDateDisplay }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">性别</span>
            <span class="detail-value">{{ result.genderLabel }}</span>
          </div>
        </div>
      </div>

      <p class="disclaimer">仅供测试/开发用途，生成的号码为虚构数据，不代表真实身份。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { generateIdCard, GENDER } from '../shared/generator.js';

const gender = ref(GENDER.RANDOM);
const ageRange = ref([18, 60]);
const result = ref(null);

function handleGenerate() {
  result.value = generateIdCard({
    gender: gender.value,
    minAge: ageRange.value[0],
    maxAge: ageRange.value[1],
  });
}

async function handleCopy() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.id);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败，请手动复制');
  }
}

onMounted(() => {
  handleGenerate();
});
</script>

<style scoped>
.id-card-page {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
  overflow: auto;
}

.generator-card {
  width: 100%;
  max-width: 520px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  padding: var(--spacing-2xl);
  box-shadow: var(--shadow-sm);
}

.config-form {
  margin-bottom: var(--spacing-lg);
}

.actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xl);
}

.result-section {
  padding: var(--spacing-lg);
  background: var(--color-muted);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-lg);
}

.id-number {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: 2px;
  color: var(--color-text-primary);
  text-align: center;
  margin-bottom: var(--spacing-lg);
  word-break: break-all;
}

.result-details {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.detail-item {
  display: flex;
  gap: var(--spacing-md);
  font-size: var(--font-size-sm);
}

.detail-label {
  flex-shrink: 0;
  width: 64px;
  color: var(--color-text-tertiary);
}

.detail-value {
  color: var(--color-text-primary);
}

.disclaimer {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.5;
  text-align: center;
}
</style>
