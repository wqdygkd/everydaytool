<script setup lang="ts">
import type { OutlookPasswordOptions } from '../../../../shared/outlook-register'
import { toast } from 'vue-sonner'
import {
  generateOutlookPassword,
  normalizeOutlookPasswordOptions,
  OUTLOOK_PASSWORD_LENGTHS,
  validateOutlookPassword,
} from '../../../../shared/outlook-register'
import { useOutlookRegisterStore } from '../stores/outlookRegisterStore'

const emit = defineEmits<{
  applied: [password: string]
}>()
const open = defineModel<boolean>({ required: true })

const store = useOutlookRegisterStore()

const length = ref('16')
const uppercase = ref(true)
const lowercase = ref(true)
const digits = ref(true)
const symbols = ref(true)
const password = ref('')
const saving = ref(false)

const lengthOptions = OUTLOOK_PASSWORD_LENGTHS.map(value => ({ label: `${value} 位`, value: String(value) }))
const enabledCount = computed(() => Number(uppercase.value) + Number(lowercase.value) + Number(digits.value) + Number(symbols.value))
const options = computed<OutlookPasswordOptions>(() => ({
  length: Number(length.value) || 16,
  uppercase: uppercase.value,
  lowercase: lowercase.value,
  digits: digits.value,
  symbols: symbols.value,
}))
const validationError = computed(() => validateOutlookPassword(password.value))

function applyOptions(next: OutlookPasswordOptions): void {
  length.value = String(next.length)
  uppercase.value = next.uppercase
  lowercase.value = next.lowercase
  digits.value = next.digits
  symbols.value = next.symbols
}

watch(open, (value) => {
  if (!value) return
  applyOptions(normalizeOutlookPasswordOptions(store.settings?.password))
  const current = store.draft
  password.value = current && current.passwordReadable && current.password
    ? current.password
    : generateOutlookPassword(options.value)
})

function regenerate(): void {
  password.value = generateOutlookPassword(options.value)
}

async function apply(): Promise<void> {
  if (validationError.value) {
    toast.error(validationError.value)
    return
  }
  saving.value = true
  try {
    await store.updateDraft({ password: password.value })
    await store.updateSettings({ password: options.value })
    toast.success('复杂密码已应用；复制后手动填入注册页')
    emit('applied', password.value)
    open.value = false
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog v-model="open" title="生成复杂密码" width="500px">
    <div class="password-form">
      <UiFormField label="长度" label-width="64px">
        <UiSelect v-model="length" :options="lengthOptions" />
      </UiFormField>

      <div class="rule-grid">
        <UiSwitchField v-model="uppercase" :disabled="uppercase && enabledCount <= 3">
          大写 A–Z
        </UiSwitchField>
        <UiSwitchField v-model="lowercase" :disabled="lowercase && enabledCount <= 3">
          小写 a–z
        </UiSwitchField>
        <UiSwitchField v-model="digits" :disabled="digits && enabledCount <= 3">
          数字 0–9
        </UiSwitchField>
        <UiSwitchField v-model="symbols" :disabled="symbols && enabledCount <= 3">
          符号 !@#$
        </UiSwitchField>
      </div>

      <UiFormField label="密码" label-width="64px">
        <div class="password-row">
          <UiInput v-model="password" class="password-input mono" placeholder="至少 8 位，含三类字符" />
          <UiButton size="small" text @click="regenerate">
            重新生成
          </UiButton>
          <UiCopyButton :text="password" label="密码" />
        </div>
        <UiHint size="xs" :class="{ 'is-error': validationError }">
          {{ validationError || `${password.length} 位 · ${enabledCount} 类字符 · 可手动编辑` }}
        </UiHint>
      </UiFormField>

      <UiHint block size="xs">
        注册页密码上限按 16 位处理；规则会记住，只影响之后生成的密码，不会自动替换正在使用的草稿密码。
      </UiHint>
    </div>
    <template #footer>
      <div class="password-footer">
        <UiButton @click="open = false">
          取消
        </UiButton>
        <UiButton type="primary" :loading="saving" :disabled="!!validationError" @click="apply">
          应用
        </UiButton>
      </div>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.password-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rule-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}

.password-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.password-input {
  flex: 1;
  min-width: 0;
}

.is-error {
  color: var(--color-danger);
}

.password-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
</style>
