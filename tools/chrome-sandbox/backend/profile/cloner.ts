import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { copyIfExists, copyPath, ensureDir, movePath, pathExists, readJson, readJsonFile, removeIfExists, writeJson } from '../../../../backend/utils/file-ops.js'
import { logger } from '../../../../backend/utils/logger.js'
import { getChromeUserDataRoot, getDefaultChromeProfilePath, getSandboxProfileDirectoryName } from '../utils/path-helper.js'

type JsonObject = Record<string, any>

const PROFILE_ITEMS_CORE = ['Bookmarks', 'Preferences']
/** Chrome 已保存密码（及账号同步密码）对应的 SQLite 库名 */
const PROFILE_PASSWORD_DATABASES = ['Login Data', 'Login Data For Account']
const SQLITE_SIDECAR_SUFFIXES = ['', '-journal', '-wal', '-shm']
const PROFILE_ITEM_SECURE_PREFS = 'Secure Preferences'
const EXTENSION_STATE_ITEMS = ['Extension State', 'Local Extension Settings', 'Extension Scripts', 'Extension Rules']
const EXTENSION_ASSET_ITEMS = ['Extensions', ...EXTENSION_STATE_ITEMS]
const EXTENSION_PROFILE_ITEMS = [...EXTENSION_ASSET_ITEMS, PROFILE_ITEM_SECURE_PREFS]

interface CloneOptions {
  inheritExtensions?: boolean
}

function getCloneItems(inheritExtensions: boolean): string[] {
  return inheritExtensions
    ? [...PROFILE_ITEMS_CORE, PROFILE_ITEM_SECURE_PREFS, ...EXTENSION_ASSET_ITEMS]
    : PROFILE_ITEMS_CORE
}

async function copyProfilePasswordStores(sourceProfilePath: string, targetProfilePath: string): Promise<void> {
  for (const dbName of PROFILE_PASSWORD_DATABASES) {
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      const item = `${dbName}${suffix}`
      const src = path.join(sourceProfilePath, item)
      const dest = path.join(targetProfilePath, item)
      const copied = await copyIfExists(src, dest)
      if (copied) {
        logger.info('Profile password store item', { item, src, dest })
      }
    }
  }
}

async function removeExtensionProfileData(profilePath: string): Promise<void> {
  for (const item of EXTENSION_PROFILE_ITEMS) {
    await removeIfExists(path.join(profilePath, item))
  }
}

export async function cloneProfile(
  targetProfilePath: string,
  sourceProfilePath: string = getDefaultChromeProfilePath(),
  options: CloneOptions = {},
): Promise<string> {
  const { inheritExtensions = false } = options
  await ensureDir(targetProfilePath)
  const items = getCloneItems(inheritExtensions)

  for (const item of items) {
    const src = path.join(sourceProfilePath, item)
    const dest = path.join(targetProfilePath, item)
    const copied = await copyIfExists(src, dest)
    logger.info('Profile clone item', { item, copied, inheritExtensions, src, dest })
  }

  await copyProfilePasswordStores(sourceProfilePath, targetProfilePath)

  await patchPreferences(targetProfilePath, { inheritExtensions })
  if (!inheritExtensions) {
    await removeExtensionProfileData(targetProfilePath)
  }
  return targetProfilePath
}

export async function initSandboxUserData(
  sandboxPath: string,
  sourceProfilePath: string = getDefaultChromeProfilePath(),
  options: CloneOptions = {},
): Promise<string> {
  const { inheritExtensions = false } = options
  const sandboxId = path.basename(sandboxPath)
  const profileDirName = getSandboxProfileDirectoryName(sandboxId)
  const profilePath = path.join(sandboxPath, profileDirName)
  await cloneProfile(profilePath, sourceProfilePath, { inheritExtensions })
  await writeLocalStateProfile(sandboxPath, profileDirName, { copyFromSource: true, inheritExtensions })
  return sandboxPath
}

export async function repairSandboxProfile(
  sandboxPath: string,
  sourceProfilePath: string = getDefaultChromeProfilePath(),
  options: CloneOptions = {},
): Promise<void> {
  const { inheritExtensions = false } = options
  const sandboxId = path.basename(sandboxPath)
  const profileDirName = getSandboxProfileDirectoryName(sandboxId)
  const profilePath = await ensureSandboxProfilePath(sandboxPath, profileDirName)
  await ensureDir(profilePath)

  const loginDataPath = path.join(profilePath, 'Login Data')
  if (!await pathExists(loginDataPath)) {
    await copyProfilePasswordStores(sourceProfilePath, profilePath)
  }

  if (inheritExtensions) {
    for (const item of EXTENSION_STATE_ITEMS) {
      const dest = path.join(profilePath, item)
      if (!await pathExists(dest)) {
        const src = path.join(sourceProfilePath, item)
        const copied = await copyIfExists(src, dest)
        if (copied) {
          logger.info('Profile repair item', { item, src, dest })
        }
      }
    }
  } else {
    await removeExtensionProfileData(profilePath)
  }

  const localStatePath = path.join(sandboxPath, 'Local State')
  await writeLocalStateProfile(sandboxPath, profileDirName, {
    copyFromSource: !await pathExists(localStatePath),
    inheritExtensions,
  })

  await patchPreferences(profilePath, { inheritExtensions })
}

async function ensureSandboxProfilePath(sandboxPath: string, profileDirName: string): Promise<string> {
  const profilePath = path.join(sandboxPath, profileDirName)
  const legacyProfilePath = path.join(sandboxPath, 'Default')

  if (!await pathExists(profilePath) && await pathExists(legacyProfilePath)) {
    await movePath(legacyProfilePath, profilePath)
    logger.info('Migrated sandbox profile directory', { from: 'Default', to: profileDirName })
  }

  return profilePath
}

function applySandboxProfileMeta(localState: JsonObject, profileDirName: string): void {
  localState.profile = localState.profile || {}
  localState.profile.info_cache = {
    [profileDirName]: {
      name: profileDirName,
      is_using_default_name: true,
    },
  }
  localState.profile.last_used = profileDirName
  localState.profile.profiles_created = 1
  localState.profile.profiles_order = [profileDirName]
}

function stripLocalStateExtensions(localState: JsonObject): void {
  delete localState.extensions
  delete localState.updateclientdata
}

async function writeLocalStateProfile(
  sandboxPath: string,
  profileDirName: string,
  options: { copyFromSource?: boolean, inheritExtensions?: boolean } = {},
): Promise<void> {
  const { copyFromSource = false, inheritExtensions = false } = options
  const destLocalState = path.join(sandboxPath, 'Local State')

  if (copyFromSource) {
    const sourceLocalState = path.join(getChromeUserDataRoot(), 'Local State')
    if (await pathExists(sourceLocalState)) {
      await copyPath(sourceLocalState, destLocalState)
    }
  }

  const localState = await readJsonFile<JsonObject>(destLocalState, {})
  applySandboxProfileMeta(localState, profileDirName)
  if (!inheritExtensions) {
    stripLocalStateExtensions(localState)
  }
  await writeJson(destLocalState, localState)
  logger.info('Local State updated for sandbox profile', { profileDirName, destLocalState, inheritExtensions })
}

async function patchPreferences(
  profilePath: string,
  options: { inheritExtensions?: boolean } = {},
): Promise<void> {
  const { inheritExtensions = false } = options
  const prefsPath = path.join(profilePath, 'Preferences')
  const prefs = await readJsonFile<JsonObject>(prefsPath, {})

  prefs.session = prefs.session || {}
  prefs.session.restore_on_startup = 1

  if (!inheritExtensions) {
    const developerMode = prefs.extensions?.ui?.developer_mode
    prefs.extensions = { settings: { enable_extensions: true } }
    if (developerMode !== undefined) {
      prefs.extensions.ui = { developer_mode: developerMode }
    }
  } else {
    prefs.extensions = prefs.extensions || {}
    prefs.extensions.settings = prefs.extensions.settings || {}
    prefs.extensions.settings.enable_extensions = true
  }

  await writeJson(prefsPath, prefs)
  logger.info('Preferences patched for session restore and extensions', { prefsPath, inheritExtensions })
}

interface ProfileExtensionInfo {
  extensionId: string
  extensionName: string
  extensionPath: string
}

export async function readExtensionsFromProfile(profilePath: string): Promise<ProfileExtensionInfo[]> {
  const extensionsDir = path.join(profilePath, 'Extensions')
  if (!await pathExists(extensionsDir)) return []

  const extensions: ProfileExtensionInfo[] = []
  const extensionIds = await readdir(extensionsDir)

  for (const extensionId of extensionIds) {
    if (extensionId.startsWith('.')) continue
    const extRoot = path.join(extensionsDir, extensionId)
    const extStat = await stat(extRoot)
    if (!extStat.isDirectory()) continue

    const versions = await readdir(extRoot)
    const latestVersion = versions.filter(v => !v.startsWith('.')).sort().pop()
    if (!latestVersion) continue

    const manifestPath = path.join(extRoot, latestVersion, 'manifest.json')
    let name = extensionId
    if (await pathExists(manifestPath)) {
      try {
        const manifest = await readJson<{ name?: string }>(manifestPath)
        name = manifest.name || extensionId
      } catch {
        // ignore
      }
    }

    extensions.push({
      extensionId,
      extensionName: name,
      extensionPath: path.join(extRoot, latestVersion),
    })
  }

  return extensions
}
