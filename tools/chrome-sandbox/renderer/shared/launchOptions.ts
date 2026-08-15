import type { LaunchOptions, SandboxMetadata } from '../../../../shared/types'

export interface LaunchOptionsForm {
  disableSafetyChecks: boolean
  disableCors: boolean
  enableCustomArgs: boolean
  customArgs: string
}

export const LAUNCH_OPTION_FORM_FIELDS: LaunchOptionsForm = {
  disableSafetyChecks: false,
  disableCors: false,
  enableCustomArgs: false,
  customArgs: '',
}

export function syncLaunchOptionsForm(form: LaunchOptionsForm, launchOptions?: LaunchOptions | null): void {
  const opts = launchOptions || {}
  form.disableSafetyChecks = Boolean(opts.disableSafetyChecks)
  form.disableCors = Boolean(opts.disableCors)
  form.enableCustomArgs = Boolean(opts.customArgs)
  form.customArgs = opts.customArgs || ''
}

export function buildLaunchOptionsPayload(form: LaunchOptionsForm): LaunchOptions {
  return {
    disableSafetyChecks: form.disableSafetyChecks,
    disableCors: form.disableCors,
    customArgs: form.enableCustomArgs ? form.customArgs.trim() : '',
  }
}

export function hasLaunchOptions(metadata: SandboxMetadata | null | undefined): boolean {
  const opts = metadata?.launchOptions
  if (!opts) return false
  return Boolean(opts.disableSafetyChecks || opts.disableCors || opts.customArgs)
}
