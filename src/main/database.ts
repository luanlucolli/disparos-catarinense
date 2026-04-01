import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'

export type CampaignStatus =
  | 'Concluído'
  | 'Pausado'
  | 'Falhou'
  | 'Em andamento'
  | 'Aguardando'
  | 'Agendado'

export type TemplateInput = {
  id: string
  title: string
  text: string
  doc?: unknown
}

export type TemplateRecord = {
  id: string
  title: string
  text: string
  doc?: unknown
  created_at: string
}

type TemplateRow = {
  id: string
  title: string
  text: string
  doc: string | null
  created_at: string
}

export type CampaignInput = {
  id: string
  name: string
  status: CampaignStatus
  total_contacts: number
  sent_count?: number
  success_count?: number
  failed_count?: number
  config?: unknown
  messages?: unknown
}

export type CampaignRecord = {
  id: string
  name: string
  status: CampaignStatus
  total_contacts: number
  sent_count: number
  success_count: number
  failed_count: number
  created_at: string
  finished_at: string | null
  config?: unknown
  messages?: unknown
}

type CampaignRow = {
  id: string
  name: string
  status: CampaignStatus
  total_contacts: number
  sent_count: number
  success_count: number
  failed_count: number
  created_at: string
  finished_at: string | null
  config: string | null
  messages: string | null
}

export type CampaignContactInput = {
  name: string
  number: string
}

export type CampaignContactRecord = {
  id: number
  campaign_id: string
  name: string
  number: string
  status: string
  error_log: string | null
}

export type CampaignProgress = {
  sent: number
  success: number
  failed: number
}

type DatabaseInstance = InstanceType<typeof Database>

let db: DatabaseInstance | null = null

const parseJson = <T>(value: string | null): T | undefined => {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

const mapTemplateRow = (row: TemplateRow): TemplateRecord => {
  const parsedDoc = parseJson<unknown>(row.doc)

  return {
    id: row.id,
    title: row.title,
    text: row.text,
    ...(parsedDoc !== undefined ? { doc: parsedDoc } : {}),
    created_at: row.created_at
  }
}

const mapCampaignRow = (row: CampaignRow): CampaignRecord => {
  const parsedConfig = parseJson<unknown>(row.config)
  const parsedMessages = parseJson<unknown>(row.messages)

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    total_contacts: row.total_contacts,
    sent_count: row.sent_count ?? 0,
    success_count: row.success_count ?? 0,
    failed_count: row.failed_count ?? 0,
    created_at: row.created_at,
    finished_at: row.finished_at,
    ...(parsedConfig !== undefined ? { config: parsedConfig } : {}),
    ...(parsedMessages !== undefined ? { messages: parsedMessages } : {})
  }
}

const ensureCampaignColumns = (database: DatabaseInstance): void => {
  const columns = database.prepare('PRAGMA table_info(campaigns)').all() as Array<{ name: string }>
  const hasConfig = columns.some((column) => column.name === 'config')
  const hasMessages = columns.some((column) => column.name === 'messages')

  if (!hasConfig) {
    database.exec('ALTER TABLE campaigns ADD COLUMN config TEXT')
  }

  if (!hasMessages) {
    database.exec('ALTER TABLE campaigns ADD COLUMN messages TEXT')
  }
}

const initializeDatabase = (): DatabaseInstance => {
  const databasePath = join(app.getPath('userData'), 'database.sqlite')
  const database = new Database(databasePath)

  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')

  database.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      title TEXT,
      text TEXT,
      doc TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT,
      total_contacts INTEGER,
      sent_count INTEGER,
      success_count INTEGER,
      failed_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      config TEXT,
      messages TEXT
    );

    CREATE TABLE IF NOT EXISTS campaign_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT,
      name TEXT,
      number TEXT,
      status TEXT DEFAULT 'pending',
      error_log TEXT,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
    );
  `)

  ensureCampaignColumns(database)

  return database
}

const getDb = (): DatabaseInstance => {
  if (!db) {
    db = initializeDatabase()
  }

  return db
}

export const getTemplates = (): TemplateRecord[] => {
  const database = getDb()
  const rows = database
    .prepare('SELECT id, title, text, doc, created_at FROM templates ORDER BY created_at DESC')
    .all() as TemplateRow[]

  return rows.map(mapTemplateRow)
}

export const saveTemplate = (template: TemplateInput): TemplateRecord => {
  const database = getDb()
  const serializedDoc = template.doc === undefined ? null : JSON.stringify(template.doc)

  database
    .prepare(
      `INSERT OR REPLACE INTO templates (id, title, text, doc)
       VALUES (@id, @title, @text, @doc)`
    )
    .run({
      id: template.id,
      title: template.title,
      text: template.text,
      doc: serializedDoc
    })

  const savedRow = database
    .prepare('SELECT id, title, text, doc, created_at FROM templates WHERE id = ?')
    .get(template.id) as TemplateRow | undefined

  if (!savedRow) {
    throw new Error('Falha ao salvar template no banco de dados.')
  }

  return mapTemplateRow(savedRow)
}

export const deleteTemplate = (id: string): boolean => {
  const database = getDb()
  const result = database.prepare('DELETE FROM templates WHERE id = ?').run(id)

  return result.changes > 0
}

export const getCampaigns = (): CampaignRecord[] => {
  const database = getDb()

  const rows = database
    .prepare(
      `SELECT
        id,
        name,
        status,
        total_contacts,
        sent_count,
        success_count,
        failed_count,
        created_at,
        finished_at,
        config,
        messages
       FROM campaigns
       ORDER BY created_at DESC`
    )
    .all() as CampaignRow[]

  return rows.map(mapCampaignRow)
}

export const getCampaignById = (campaignId: string): CampaignRecord | null => {
  const database = getDb()

  const row = database
    .prepare(
      `SELECT
        id,
        name,
        status,
        total_contacts,
        sent_count,
        success_count,
        failed_count,
        created_at,
        finished_at,
        config,
        messages
       FROM campaigns
       WHERE id = ?`
    )
    .get(campaignId) as CampaignRow | undefined

  return row ? mapCampaignRow(row) : null
}

export const getCampaignsByStatus = (status: CampaignStatus): CampaignRecord[] => {
  const database = getDb()

  const rows = database
    .prepare(
      `SELECT
        id,
        name,
        status,
        total_contacts,
        sent_count,
        success_count,
        failed_count,
        created_at,
        finished_at,
        config,
        messages
       FROM campaigns
       WHERE status = ?
       ORDER BY created_at ASC`
    )
    .all(status) as CampaignRow[]

  return rows.map(mapCampaignRow)
}

export const getOldestCampaignByStatus = (status: CampaignStatus): CampaignRecord | null => {
  const database = getDb()

  const row = database
    .prepare(
      `SELECT
        id,
        name,
        status,
        total_contacts,
        sent_count,
        success_count,
        failed_count,
        created_at,
        finished_at,
        config,
        messages
       FROM campaigns
       WHERE status = ?
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(status) as CampaignRow | undefined

  return row ? mapCampaignRow(row) : null
}

export const getCampaignContacts = (campaignId: string): CampaignContactRecord[] => {
  const database = getDb()

  return database
    .prepare(
      `SELECT id, campaign_id, name, number, status, error_log
       FROM campaign_contacts
       WHERE campaign_id = ?
       ORDER BY id ASC`
    )
    .all(campaignId) as CampaignContactRecord[]
}

export const getPendingCampaignContacts = (campaignId: string): CampaignContactRecord[] => {
  const database = getDb()

  return database
    .prepare(
      `SELECT id, campaign_id, name, number, status, error_log
       FROM campaign_contacts
       WHERE campaign_id = ? AND status = 'pending'
       ORDER BY id ASC`
    )
    .all(campaignId) as CampaignContactRecord[]
}

export const createCampaign = (campaign: CampaignInput, contacts: CampaignContactInput[]): CampaignRecord => {
  const database = getDb()

  const insertCampaign = database.prepare(
    `INSERT INTO campaigns (
      id,
      name,
      status,
      total_contacts,
      sent_count,
      success_count,
      failed_count,
      config,
      messages
    ) VALUES (
      @id,
      @name,
      @status,
      @total_contacts,
      @sent_count,
      @success_count,
      @failed_count,
      @config,
      @messages
    )`
  )

  const insertContact = database.prepare(
    `INSERT INTO campaign_contacts (campaign_id, name, number, status, error_log)
     VALUES (@campaign_id, @name, @number, 'pending', NULL)`
  )

  const transaction = database.transaction((campaignData: CampaignInput, campaignContacts: CampaignContactInput[]) => {
    insertCampaign.run({
      id: campaignData.id,
      name: campaignData.name,
      status: campaignData.status,
      total_contacts: campaignData.total_contacts,
      sent_count: campaignData.sent_count ?? 0,
      success_count: campaignData.success_count ?? 0,
      failed_count: campaignData.failed_count ?? 0,
      config: campaignData.config === undefined ? null : JSON.stringify(campaignData.config),
      messages: campaignData.messages === undefined ? null : JSON.stringify(campaignData.messages)
    })

    for (const contact of campaignContacts) {
      insertContact.run({
        campaign_id: campaignData.id,
        name: contact.name,
        number: contact.number
      })
    }
  })

  transaction(campaign, contacts)

  const createdCampaign = getCampaignById(campaign.id)

  if (!createdCampaign) {
    throw new Error('Falha ao criar campanha no banco de dados.')
  }

  return createdCampaign
}

export const updateCampaignStatus = (campaignId: string, status: CampaignStatus): boolean => {
  const database = getDb()

  const shouldClearFinishedAt = status !== 'Concluído' && status !== 'Falhou'

  const result = shouldClearFinishedAt
    ? database
        .prepare(
          `UPDATE campaigns
           SET
             status = ?,
             finished_at = NULL
           WHERE id = ?`
        )
        .run(status, campaignId)
    : database
        .prepare(
          `UPDATE campaigns
           SET status = ?
           WHERE id = ?`
        )
        .run(status, campaignId)

  return result.changes > 0
}

export const updateCampaignPayload = (campaignId: string, config: unknown, messages: unknown): boolean => {
  const database = getDb()

  const result = database
    .prepare(
      `UPDATE campaigns
       SET
         config = ?,
         messages = ?
       WHERE id = ?`
    )
    .run(
      config === undefined ? null : JSON.stringify(config),
      messages === undefined ? null : JSON.stringify(messages),
      campaignId
    )

  return result.changes > 0
}

export const updateCampaignProgress = (
  campaignId: string,
  sentCount: number,
  successCount: number,
  failedCount: number
): boolean => {
  const database = getDb()

  const result = database
    .prepare(
      `UPDATE campaigns
       SET
         sent_count = ?,
         success_count = ?,
         failed_count = ?
       WHERE id = ?`
    )
    .run(sentCount, successCount, failedCount, campaignId)

  return result.changes > 0
}

export const updateCampaignContactStatus = (
  contactId: number,
  status: string,
  errorLog: string | null = null
): boolean => {
  const database = getDb()

  const result = database
    .prepare(
      `UPDATE campaign_contacts
       SET status = ?, error_log = ?
       WHERE id = ?`
    )
    .run(status, errorLog, contactId)

  return result.changes > 0
}

export const finishCampaign = (
  campaignId: string,
  status: CampaignStatus,
  sentCount: number,
  successCount: number,
  failedCount: number
): boolean => {
  const database = getDb()

  const result = database
    .prepare(
      `UPDATE campaigns
       SET
         status = ?,
         sent_count = ?,
         success_count = ?,
         failed_count = ?,
         finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(status, sentCount, successCount, failedCount, campaignId)

  return result.changes > 0
}
