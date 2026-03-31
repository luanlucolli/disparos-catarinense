import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcRendererEvent } from 'electron'

type WhatsAppEventType = 'qr' | 'ready' | 'authenticated' | 'disconnected'

type WhatsAppEventData = {
  type: WhatsAppEventType
  payload?: unknown
}

type WhatsAppEventCallback = (event: IpcRendererEvent, data: WhatsAppEventData) => void

type TemplatePayload = {
  id: string
  title: string
  text: string
  doc?: unknown
}

type TemplateRecord = TemplatePayload & {
  created_at: string
}

type CampaignPayload = {
  id: string
  name: string
  status: string
  total_contacts: number
  sent_count?: number
  success_count?: number
  failed_count?: number
}

type CampaignRecord = Required<Pick<CampaignPayload, 'sent_count' | 'success_count' | 'failed_count'>> &
  Omit<CampaignPayload, 'sent_count' | 'success_count' | 'failed_count'> & {
    created_at: string
    finished_at: string | null
  }

type CampaignContactPayload = {
  name: string
  number: string
}

type CampaignContactRecord = CampaignContactPayload & {
  id: number
  campaign_id: string
  status: string
  error_log: string | null
}

type CampaignServiceConfig = {
  minDelay: number
  maxDelay: number
  cooldownEnabled: boolean
  cooldownMinutes: number
  cooldownEvery: number
  simulateTyping?: boolean
  waitLinkPreview?: boolean
  scheduled?: boolean
  scheduleDate?: string | Date | null
  scheduleHour?: string
  scheduleMinute?: string
}

type CampaignProgressData = {
  campaignId: string
  sent: number
  success: number
  failed: number
  status?: string
  log?: string
  contactId?: number
  contactName?: string
  contactNumber?: string
  contactStatus?: string
  error?: string | null
  finishedAt?: string
}

type CampaignProgressCallback = (data: CampaignProgressData) => void

interface AppAPI {
  onWhatsAppEvent: (callback: WhatsAppEventCallback) => () => void
  iniciarConexao: () => void
  desconectar: () => void
  forcarReset: () => void
  getTemplates: () => Promise<TemplateRecord[]>
  saveTemplate: (template: TemplatePayload) => Promise<TemplateRecord>
  deleteTemplate: (id: string) => Promise<boolean>
  getCampaigns: () => Promise<CampaignRecord[]>
  createCampaign: (campaign: CampaignPayload, contacts: CampaignContactPayload[]) => Promise<CampaignRecord>
  getCampaignContacts: (campaignId: string) => Promise<CampaignContactRecord[]>
  finishCampaign: (
    campaignId: string,
    status: string,
    sentCount: number,
    successCount: number,
    failedCount: number
  ) => Promise<boolean>
  startCampaign: (campaignId: string, config: CampaignServiceConfig, messages: unknown[]) => Promise<boolean>
  pauseCampaign: (campaignId: string) => Promise<boolean>
  resumeCampaign: (campaignId: string) => Promise<boolean>
  cancelCampaign: (campaignId: string) => Promise<boolean>
  onCampaignProgress: (callback: CampaignProgressCallback) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
