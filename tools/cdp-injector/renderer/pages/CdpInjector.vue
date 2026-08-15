<template>
  <div class="cdp-injector-page">
    <el-tabs v-model="activeTab" class="cdp-tabs">
      <el-tab-pane label="应用配置" name="profiles">
        <div class="tab-toolbar">
          <el-button type="primary" @click="openProfileDialog()">新增应用</el-button>
        </div>
        <el-table :data="store.profiles" v-loading="store.loading" empty-text="暂无应用，点击「新增应用」添加">
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column prop="executable" label="可执行文件" min-width="200" show-overflow-tooltip />
          <el-table-column prop="debugPort" label="调试端口" width="100" />
          <el-table-column label="脚本" min-width="120">
            <template #default="{ row }">
              {{ scriptName(row.scriptId) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.id)" size="small">{{ statusLabel(row.id) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openProfileDialog(row)">编辑</el-button>
              <el-button
                link
                type="success"
                :disabled="isRunning(row.id)"
                @click="launchOne(row.id)"
              >
                启动
              </el-button>
              <el-button
                link
                type="warning"
                :disabled="!isRunning(row.id)"
                @click="store.stop(row.id)"
              >
                停止
              </el-button>
              <el-button link type="danger" @click="removeProfile(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="脚本库" name="scripts">
        <div class="tab-toolbar">
          <el-button type="primary" @click="openScriptDialog()">新增脚本</el-button>
        </div>
        <el-table :data="store.scripts" v-loading="store.loading" empty-text="暂无脚本">
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openScriptDialog(row)">编辑</el-button>
              <el-button link type="danger" @click="removeScript(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="批量运行" name="run">
        <div class="run-panel">
          <p class="run-hint">
            勾选要启动的应用，将自动附加 <code>--remote-debugging-port</code>（若启动参数中未指定），
            并通过 CDP 在每次页面加载前注入脚本。支持 <code>file://</code> 与 <code>https://</code> 页面。
          </p>
          <el-checkbox-group v-model="selectedIds" class="run-checkboxes">
            <el-checkbox
              v-for="profile in store.profiles"
              :key="profile.id"
              :label="profile.id"
              :disabled="isRunning(profile.id)"
            >
              {{ profile.name }}（端口 {{ profile.debugPort }}）
            </el-checkbox>
          </el-checkbox-group>
          <div v-if="store.profiles.length === 0" class="empty-run">请先在「应用配置」中添加应用</div>
          <div class="run-actions">
            <el-button type="primary" :disabled="selectedIds.length === 0" @click="launchSelected">
              批量启动并注入
            </el-button>
            <el-button :disabled="store.running.length === 0" @click="store.stopAll()">全部停止</el-button>
          </div>
          <div v-if="store.running.length > 0" class="running-section">
            <h4>运行中</h4>
            <el-table
              :data="store.running"
              row-key="profileId"
              class="running-table"
              @expand-change="onRunningExpandChange"
            >
              <el-table-column type="expand">
                <template #default="{ row }">
                  <div class="targets-expand">
                    <div class="targets-expand-toolbar">
                      <span class="targets-expand-title">CDP 页面列表（端口 {{ row.port }}）</span>
                      <div class="targets-expand-actions">
                        <el-button size="small" @click="openDevToolsIndex(row)">调试入口页</el-button>
                        <el-button
                          size="small"
                          :loading="targetsLoading[row.profileId]"
                          @click="loadTargets(row.profileId, row.port)"
                        >
                          刷新
                        </el-button>
                      </div>
                    </div>
                    <el-table
                      :data="targetsCache[row.profileId] ?? []"
                      size="small"
                      v-loading="targetsLoading[row.profileId]"
                      empty-text="暂无页面，点击刷新获取"
                    >
                      <el-table-column prop="type" label="类型" width="80">
                        <template #default="{ row: target }">
                          <el-tag size="small" :type="target.type === 'iframe' ? 'warning' : 'primary'">
                            {{ target.type }}
                          </el-tag>
                        </template>
                      </el-table-column>
                      <el-table-column prop="title" label="标题" min-width="140" show-overflow-tooltip />
                      <el-table-column prop="url" label="URL" min-width="240" show-overflow-tooltip />
                      <el-table-column label="操作" width="200" fixed="right">
                        <template #default="{ row: target }">
                          <el-button link type="primary" @click="openDevToolsForTarget(target)">
                            打开 DevTools
                          </el-button>
                          <el-button link @click="openDevToolsForTarget(target, { external: true })">
                            外部浏览器
                          </el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="应用" min-width="120">
                <template #default="{ row }">
                  {{ row.name || row.profileId }}
                </template>
              </el-table-column>
              <el-table-column label="PID" width="90">
                <template #default="{ row }">{{ row.pid ?? '-' }}</template>
              </el-table-column>
              <el-table-column prop="port" label="端口" width="80" />
              <el-table-column prop="message" label="状态" min-width="180" show-overflow-tooltip />
              <el-table-column label="DevTools" min-width="320" fixed="right">
                <template #default="{ row }">
                  <div class="devtools-quick">
                    <el-select
                      v-model="selectedTargetId[row.profileId]"
                      placeholder="选择页面"
                      style="flex: 1"
                      @visible-change="(visible) => visible && ensureTargets(row.profileId, row.port)"
                    >
                      <el-option
                        v-for="target in targetsCache[row.profileId] ?? []"
                        :key="target.id"
                        :label="targetLabel(target)"
                        :value="target.id"
                      />
                    </el-select>
                    <el-button
                      type="primary"
                      :disabled="!selectedTargetId[row.profileId]"
                      @click="openSelectedTarget(row.profileId)"
                    >
                      打开
                    </el-button>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="store.reinject(row.profileId)">重新注入</el-button>
                  <el-button link type="warning" @click="store.stop(row.profileId)">停止</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="profileDialogVisible" :title="profileForm.id ? '编辑应用' : '新增应用'" width="640px">
      <el-form :model="profileForm" label-width="110px">
        <el-form-item label="名称" required>
          <el-input v-model="profileForm.name" placeholder="例如：某 Electron 客户端" />
        </el-form-item>
        <el-form-item label="可执行文件" required>
          <div class="path-row">
            <el-input
              v-model="profileForm.executable"
              placeholder="Windows: C:\path\app.exe；macOS: /Applications/App.app"
            />
            <el-button @click="pickExecutable">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item label="启动参数">
          <el-input
            v-model="profileForm.args"
            type="textarea"
            :rows="2"
            placeholder="可选，空格分隔。若未写 --remote-debugging-port 将自动追加"
          />
        </el-form-item>
        <el-form-item label="调试端口" required>
          <el-input-number v-model="profileForm.debugPort" :min="1024" :max="65535" />
        </el-form-item>
        <el-form-item label="关联脚本" required>
          <el-select v-model="profileForm.scriptId" placeholder="选择脚本库中的脚本" style="width: 100%">
            <el-option
              v-for="script in store.scripts"
              :key="script.id"
              :label="script.name"
              :value="script.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="启动等待(ms)">
          <el-input-number v-model="profileForm.startupDelayMs" :min="0" :max="120000" :step="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="profileDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scriptDialogVisible" :title="scriptForm.id ? '编辑脚本' : '新增脚本'" width="720px">
      <el-form :model="scriptForm" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="scriptForm.name" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="scriptForm.description" />
        </el-form-item>
        <el-form-item label="脚本" required>
          <div class="script-toolbar">
            <el-button size="small" @click="importScriptFile">从文件导入</el-button>
          </div>
          <el-input
            v-model="scriptForm.content"
            type="textarea"
            :rows="14"
            placeholder="在此编写将在每次页面加载前执行的 JavaScript"
            class="script-editor"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scriptDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveScript">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useCdpInjectorStore } from '../stores/cdpInjectorStore.js';
import { invokeCdpIpc, cdpIpcChannels } from '@renderer/shared/ipc/useCdpIpc.js';

const store = useCdpInjectorStore();
const channels = cdpIpcChannels();
const activeTab = ref('profiles');
const selectedIds = ref([]);
let unsubscribeStatus = null;

const profileDialogVisible = ref(false);
const scriptDialogVisible = ref(false);
const targetsCache = reactive({});
const targetsLoading = reactive({});
const selectedTargetId = reactive({});

const profileForm = reactive({
  id: '',
  name: '',
  executable: '',
  args: '',
  debugPort: 9333,
  scriptId: '',
  startupDelayMs: 2000,
});

const scriptForm = reactive({
  id: '',
  name: '',
  description: '',
  content: '',
});

const ACTIVE_STATUSES = ['launching', 'waiting', 'connecting', 'running'];

const STATUS_LABELS = {
  launching: '启动中',
  waiting: '等待 CDP',
  connecting: '连接中',
  running: '运行中',
  error: '错误',
  stopped: '已停止',
};

function scriptName(scriptId) {
  return store.scripts.find((s) => s.id === scriptId)?.name ?? '-';
}

function isRunning(profileId) {
  const state = store.getRunningState(profileId);
  return Boolean(state && ACTIVE_STATUSES.includes(state.status));
}

function statusLabel(profileId) {
  const state = store.getRunningState(profileId);
  if (!state) return '未运行';
  return STATUS_LABELS[state.status] ?? state.status;
}

function statusTagType(profileId) {
  const state = store.getRunningState(profileId);
  if (!state) return 'info';
  if (state.status === 'running') return 'success';
  if (state.status === 'error') return 'danger';
  return 'warning';
}

function openProfileDialog(row) {
  if (row) {
    Object.assign(profileForm, {
      id: row.id,
      name: row.name,
      executable: row.executable,
      args: row.args ?? '',
      debugPort: row.debugPort ?? 9333,
      scriptId: row.scriptId ?? '',
      startupDelayMs: row.startupDelayMs ?? 2000,
    });
  } else {
    Object.assign(profileForm, {
      id: '',
      name: '',
      executable: '',
      args: '',
      debugPort: 9333,
      scriptId: store.scripts[0]?.id ?? '',
      startupDelayMs: 2000,
    });
  }
  profileDialogVisible.value = true;
}

function openScriptDialog(row) {
  if (row) {
    Object.assign(scriptForm, {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      content: row.content ?? '',
    });
  } else {
    Object.assign(scriptForm, {
      id: '',
      name: '',
      description: '',
      content: "console.log('[CDP] injected', location.href);\n",
    });
  }
  scriptDialogVisible.value = true;
}

async function pickExecutable() {
  const path = await invokeCdpIpc(channels.SELECT_EXECUTABLE);
  if (path) profileForm.executable = path;
}

async function importScriptFile() {
  const result = await invokeCdpIpc(channels.SELECT_SCRIPT_FILE);
  if (result?.content) {
    scriptForm.content = result.content;
    ElMessage.success('已导入脚本文件');
  }
}

async function saveProfile() {
  if (!profileForm.name?.trim() || !profileForm.executable?.trim() || !profileForm.scriptId) {
    ElMessage.warning('请填写名称、可执行文件并选择脚本');
    return;
  }
  await store.saveProfile({ ...profileForm });
  profileDialogVisible.value = false;
  ElMessage.success('已保存');
}

async function saveScript() {
  if (!scriptForm.name?.trim() || !scriptForm.content?.trim()) {
    ElMessage.warning('请填写名称和脚本内容');
    return;
  }
  await store.saveScript({ ...scriptForm });
  scriptDialogVisible.value = false;
  ElMessage.success('已保存');
}

async function removeProfile(id) {
  await ElMessageBox.confirm('确定删除该应用配置？', '确认');
  await store.deleteProfile(id);
  selectedIds.value = selectedIds.value.filter((item) => item !== id);
  ElMessage.success('已删除');
}

async function removeScript(id) {
  await ElMessageBox.confirm('确定删除该脚本？', '确认');
  await store.deleteScript(id);
  ElMessage.success('已删除');
}

async function launchOne(profileId) {
  const results = await store.launchBatch([profileId]);
  reportLaunchResults(results, '启动并注入成功');
}

async function launchSelected() {
  const results = await store.launchBatch(selectedIds.value);
  reportLaunchResults(results);
}

function reportLaunchResults(results, successMessage) {
  const failed = results.filter((item) => !item.ok);
  if (failed.length === 0) {
    ElMessage.success(successMessage ?? `已启动 ${results.length} 个应用`);
    return;
  }
  if (failed.length === results.length) {
    ElMessage.error(failed[0]?.error || '启动失败');
    return;
  }
  ElMessage.warning(`${results.length - failed.length} 成功，${failed.length} 失败`);
}

function targetLabel(target) {
  const type = target.type === 'iframe' ? '[iframe] ' : '';
  const title = target.title || '(无标题)';
  const url = target.url ? ` · ${target.url}` : '';
  return `${type}${title}${url}`;
}

async function loadTargets(profileId, port) {
  targetsLoading[profileId] = true;
  try {
    const targets = await store.fetchTargets(port);
    targetsCache[profileId] = targets;
    if (targets.length > 0 && !selectedTargetId[profileId]) {
      selectedTargetId[profileId] = targets[0].id;
    }
    if (targets.length === 0) {
      ElMessage.info('当前没有可用的 page 目标');
    }
  } catch (error) {
    targetsCache[profileId] = [];
    ElMessage.error(error.message || '获取页面列表失败');
  } finally {
    targetsLoading[profileId] = false;
  }
}

async function ensureTargets(profileId, port) {
  if (targetsCache[profileId]?.length) return;
  await loadTargets(profileId, port);
}

async function onRunningExpandChange(row, expandedRows) {
  const expanded = expandedRows.some((item) => item.profileId === row.profileId);
  if (expanded) {
    await loadTargets(row.profileId, row.port);
  }
}

async function openDevToolsForTarget(target, options = {}) {
  try {
    await store.openDevTools({
      devToolsUrl: target.devToolsUrl,
      title: `DevTools · ${target.title || target.url || 'page'}`,
      external: options.external === true,
    });
    const hint = options.external
      ? '已在外部浏览器打开（30 秒内暂停注入）'
      : '已打开 DevTools（调试期间已暂停脚本注入）';
    ElMessage.success(hint);
  } catch (error) {
    ElMessage.error(error.message || '打开 DevTools 失败');
  }
}

async function openDevToolsIndex(row) {
  try {
    await store.openDevTools({
      port: row.port,
      title: `CDP 调试入口 · ${row.name || row.port}`,
    });
    ElMessage.success('已打开调试入口页');
  } catch (error) {
    ElMessage.error(error.message || '打开调试入口失败');
  }
}

async function openSelectedTarget(profileId) {
  const targetId = selectedTargetId[profileId];
  const target = targetsCache[profileId]?.find((item) => item.id === targetId);
  if (!target) {
    ElMessage.warning('请先选择要打开的页面');
    return;
  }
  await openDevToolsForTarget(target);
}

watch(
  () => store.running.map((item) => item.profileId),
  (profileIds) => {
    const idSet = new Set(profileIds);
    for (const profileId of Object.keys(targetsCache)) {
      if (!idSet.has(profileId)) {
        delete targetsCache[profileId];
        delete targetsLoading[profileId];
        delete selectedTargetId[profileId];
      }
    }
  },
);

onMounted(async () => {
  unsubscribeStatus = store.bindStatusEvents();
  await store.load();
});

onUnmounted(() => {
  unsubscribeStatus?.();
});
</script>

<style scoped>
.cdp-injector-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 20px 24px 24px;
  background: var(--color-app-bg);
  overflow: hidden;
}

.cdp-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  box-shadow: var(--shadow-sm);
  padding: 14px 16px 16px;
}

.cdp-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}

.cdp-tabs :deep(.el-tabs__nav-wrap::after) {
  background: var(--color-border-light);
}

.cdp-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.tab-toolbar {
  margin-bottom: 14px;
  display: flex;
  justify-content: flex-end;
}

.path-row {
  display: flex;
  gap: var(--spacing-sm);
  width: 100%;
}

.run-panel {
  max-width: 100%;
  padding: 2px;
}

.running-section {
  margin-top: var(--spacing-lg);
}

.running-section h4 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-base);
}

.running-table {
  width: 100%;
}

.targets-expand {
  padding: 12px 14px 14px;
  background: var(--color-muted);
  border-radius: var(--radius-lg);
}

.targets-expand-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
  gap: var(--spacing-sm);
}

.targets-expand-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.targets-expand-title {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.devtools-quick {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.run-hint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  margin: 0 0 16px;
  max-width: 860px;
}

.run-hint code {
  background: var(--color-muted);
  border: 1px solid var(--color-border-light);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.run-checkboxes {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}

.run-actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xl);
}

.script-toolbar {
  margin-bottom: var(--spacing-xs);
}

.script-editor :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--font-size-sm);
}

.empty-run {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-md);
}

@media (max-width: 760px) {
  .cdp-injector-page {
    padding: 14px;
  }

  .targets-expand-toolbar,
  .devtools-quick,
  .path-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
