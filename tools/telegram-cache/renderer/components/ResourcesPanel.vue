<script setup lang="ts">
// 已下线：v1.8.0 移除了「资源」面板（观测 / 单飞去重 / 基准测试这些 M2 试验随归档化改造停用）。
// 保留文件只因本机删除受限；当前没有任何引用，Vite 不会打包它，可以直接手工删除。
</script>

<template>
  <UiPanel title="资源面板已下线">
    <UiHint block>
      这个面板在 v1.8.0 随观测类功能一起移除：缓存请在「影库」页签查看，媒体对象库在「概览」。
    </UiHint>
  </UiPanel>
</template>
