import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'

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
  status: string
  total_contacts: number
  sent_count?: number
  success_count?: number
  failed_count?: number
}

export type CampaignRecord = {
  id: string
  name: string
  status: string
  total_contacts: number
  sent_count: number
  success_count: number
  failed_count: number
  created_at: string
  finished_at: string | null
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

let db: InstanceType<typeof Database> | null = null

const parseTemplateDoc = (doc: string | null): unknown | undefined => {
  if (!doc) return undefined

  try {
    return JSON.parse(doc)
  } catch {
    return undefined
  }
}

const mapTemplateRow = (row: TemplateRow): TemplateRecord => {
  const parsedDoc = parseTemplateDoc(row.doc)

  return {
    id: row.id,
    title: row.title,
    text: row.text,
    ...(parsedDoc !== undefined ? { doc: parsedDoc } : {}),
    created_at: row.created_at
  }
}

const initializeDatabase = (): InstanceType<typeof Database> => {
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
      finished_at DATETIME
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

  return database
}

const getDb = (): InstanceType<typeof Database> => {
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

  return database
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
        finished_at
       FROM campaigns
       ORDER BY created_at DESC`
    )
    .all() as CampaignRecord[]
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
      failed_count
    ) VALUES (
      @id,
      @name,
      @status,
      @total_contacts,
      @sent_count,
      @success_count,
      @failed_count
    )`
  )

  const insertContact = database.prepare(
    `INSERT INTO campaign_contacts (campaign_id, name, number, status, error_log)
     VALUES (@campaign_id, @name, @number, 'pending', NULL)`
  )

  const transaction = database.transaction((campaignData: CampaignInput, campaignContacts: CampaignContactInput[]) => {
    insertCampaign.run({
      ...campaignData,
      sent_count: campaignData.sent_count ?? 0,
      success_count: campaignData.success_count ?? 0,
      failed_count: campaignData.failed_count ?? 0
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

  const createdCampaign = database
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
        finished_at
       FROM campaigns
       WHERE id = ?`
    )
    .get(campaign.id) as CampaignRecord | undefined

  if (!createdCampaign) {
    throw new Error('Falha ao criar campanha no banco de dados.')
  }

  return createdCampaign
}

export const finishCampaign = (
  campaignId: string,
  status: string,
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
