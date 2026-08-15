import type {
  Sandbox,
  SandboxMetadata,
  SandboxStatus,
  SandboxUpdatePayload,
} from '../../../../shared/types.js'
import { SANDBOX_COLORS } from '../constants/sandbox.js'
import { getDatabase } from './database.js'

interface SandboxRow {
  id: string
  name: string
  category: string | null
  color: string | null
  user_data_path: string
  chrome_pid: number | null
  status: SandboxStatus
  fingerprint_id: string | null
  created_at: string | null
  last_used_at: string | null
  last_active_at: string | null
  metadata: string | null
}

const FIELD_MAP: Record<string, keyof SandboxRow> = {
  name: 'name',
  category: 'category',
  color: 'color',
  userDataPath: 'user_data_path',
  chromePid: 'chrome_pid',
  status: 'status',
  fingerprintId: 'fingerprint_id',
  lastUsedAt: 'last_used_at',
  lastActiveAt: 'last_active_at',
}

function mapRow(row: SandboxRow | undefined): Sandbox | null {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    userDataPath: row.user_data_path,
    chromePid: row.chrome_pid,
    status: row.status,
    fingerprintId: row.fingerprint_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastActiveAt: row.last_active_at,
    metadata: row.metadata ? JSON.parse(row.metadata) as SandboxMetadata : null,
  }
}

interface SandboxCreateData {
  id: string
  name: string
  category?: string
  color?: string
  userDataPath: string
  fingerprintId: string | null
  metadata?: SandboxMetadata | null
}

export const sandboxStore = {
  getAll(): Sandbox[] {
    const rows = getDatabase().prepare('SELECT * FROM sandboxes').all() as SandboxRow[]
    return rows.map(mapRow).filter((row): row is Sandbox => row !== null)
  },

  getById(id: string): Sandbox | null {
    const row = getDatabase().prepare('SELECT * FROM sandboxes WHERE id = ?').get(id) as
      | SandboxRow
      | undefined
    return mapRow(row)
  },

  create(data: SandboxCreateData): Sandbox | null {
    getDatabase().prepare(`
      INSERT INTO sandboxes (id, name, category, color, user_data_path, fingerprint_id, metadata)
      VALUES (@id, @name, @category, @color, @userDataPath, @fingerprintId, @metadata)
    `).run({
      id: data.id,
      name: data.name,
      category: data.category || 'other',
      color: data.color || SANDBOX_COLORS.sandbox,
      userDataPath: data.userDataPath,
      fingerprintId: data.fingerprintId,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    })
    return this.getById(data.id)
  },

  update(id: string, data: SandboxUpdatePayload): Sandbox | null {
    const fields: string[] = []
    const params: Record<string, unknown> = { id }

    for (const [key, col] of Object.entries(FIELD_MAP)) {
      if (data[key as keyof SandboxUpdatePayload] !== undefined) {
        fields.push(`${col} = @${key}`)
        params[key] = data[key as keyof SandboxUpdatePayload]
      }
    }

    if (data.metadata !== undefined) {
      fields.push('metadata = @metadata')
      params.metadata = data.metadata ? JSON.stringify(data.metadata) : null
    }

    if (fields.length === 0) return this.getById(id)
    getDatabase().prepare(`UPDATE sandboxes SET ${fields.join(', ')} WHERE id = @id`).run(params)
    return this.getById(id)
  },

  delete(id: string): void {
    getDatabase().prepare('DELETE FROM sandboxes WHERE id = ?').run(id)
  },
}
