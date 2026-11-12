<script setup lang="ts">
// 产物卡：GitHub 的每个可下载对象（Release 资产 / 源码包 / 单个文件 / 直链）都是同一张卡。
// 头行是名字 + 右侧元信息（体积 / 下载次数 / 格式 chip），第二行起放线路按钮。
defineProps<{
  name: string
  /** tooltip：名字被截断时给出完整值 */
  title?: string
}>()
</script>

<template>
  <div class="artifact">
    <div class="artifact-head">
      <span class="artifact-name" :title="title || name">{{ name }}</span>
      <span class="artifact-meta">
        <slot name="meta" />
      </span>
    </div>
    <slot />
  </div>
</template>

<style scoped lang="scss">
.artifact {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-well);
}

.artifact-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  min-width: 0;
}

.artifact-name {
  overflow: hidden;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-meta {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-xs);
}
</style>
