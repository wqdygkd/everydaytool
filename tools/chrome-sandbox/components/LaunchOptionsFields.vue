<script setup lang="ts">
defineProps({
  form: { type: Object, required: true },
})
</script>

<!-- eslint-disable vue/no-mutating-props -->
<template>
  <UiGroup direction="column" gap="sm" class="launch-options">
    <el-checkbox v-model="form.disableSafetyChecks">
      禁用安全检查
    </el-checkbox>
    <el-checkbox v-model="form.disableCors">
      禁用 CORS
    </el-checkbox>
    <el-checkbox v-model="form.enableCustomArgs">
      自定义启动参数
    </el-checkbox>
    <el-input
      v-if="form.enableCustomArgs"
      v-model="form.customArgs"
      placeholder="例如：--window-size=800,600"
      class="custom-args-input"
    />
  </UiGroup>
</template>

<style scoped lang="scss">
.custom-args-input {
  margin-top: var(--spacing-xs);
}
</style>
