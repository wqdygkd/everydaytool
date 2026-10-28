<script setup lang="ts">
// 五个下载器共用的表单骨架：说明行（#hint）→ [#before] → 主输入框 → 示例按钮 → [#between]
// → 主 CTA → 默认插槽（结果面板 / 下载进度）。
// 间距与控件外观全部交给 UiGroup / UiHint / el-*，各下载器不再各自复制一份输入框、示例与按钮的 CSS。
withDefaults(defineProps<{
  modelValue: string
  placeholder: string
  /** 主按钮文案（loading 时替换为 loadingLabel） */
  submitLabel: string
  examples?: { label: string, value: string }[]
  loading?: boolean
  submitDisabled?: boolean
  loadingLabel?: string
}>(), {
  examples: () => [],
  loading: false,
  submitDisabled: false,
  loadingLabel: '解析中…',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'submit': []
  'example': [value: string]
}>()
</script>

<template>
  <UiGroup direction="column" gap="lg" align="stretch" block>
    <UiHint v-if="$slots.hint">
      <slot name="hint" />
    </UiHint>

    <slot name="before" />

    <el-input
      :model-value="modelValue"
      :placeholder="placeholder"
      clearable
      @update:model-value="emit('update:modelValue', $event)"
      @keyup.enter="emit('submit')"
    >
      <template #prefix>
        <UiIcon name="search" :size="16" />
      </template>
    </el-input>

    <!-- 示例：文字按钮（轻量、可 hover），不引入自定义胶囊样式 -->
    <UiGroup v-if="examples.length" gap="sm" wrap class="btn-flush">
      <el-button
        v-for="example in examples"
        :key="example.value"
        size="small"
        text
        @click="emit('example', example.value)"
      >
        {{ example.label }}
      </el-button>
    </UiGroup>

    <slot name="between" />

    <el-button
      type="primary"
      :loading="loading"
      :disabled="submitDisabled"
      @click="emit('submit')"
    >
      {{ loading ? loadingLabel : submitLabel }}
    </el-button>

    <slot />
  </UiGroup>
</template>
