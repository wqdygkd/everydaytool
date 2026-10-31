<script setup lang="ts">
// 表单行:label + 控件区(EP el-form-item 的最小替代,label 宽度可调)
withDefaults(defineProps<{
  label?: string
  labelWidth?: string
}>(), {
  labelWidth: '80px',
})
</script>

<template>
  <div class="ui-form-field" :style="{ '--ui-form-label-w': labelWidth }">
    <label v-if="label" class="ui-form-label">{{ label }}</label>
    <div class="ui-form-control">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-form-field {
  display: grid;
  grid-template-columns: var(--ui-form-label-w) 1fr;
  gap: var(--spacing-md);
  align-items: center;
  min-width: 0;
}

.ui-form-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
  line-height: var(--line-height-control);
}

.ui-form-control {
  min-width: 0;
}
</style>
