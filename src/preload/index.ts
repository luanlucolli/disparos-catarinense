import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type WhatsAppEventType = 'qr' | 'ready' | 'authenticated' | 'disconnected'

type WhatsAppEventData = {
  type: WhatsAppEventType
  payload?: unknown
}

type WhatsAppEventCallback = (event: IpcRendererEvent, data: WhatsAppEventData) => void
const allowedWhatsAppEvents: WhatsAppEventType[] = ['qr', 'ready', 'authenticated', 'disconnected']

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

const isValidWhatsAppEvent = (data: unknown): data is WhatsAppEventData => {
  if (typeof data !== 'object' || data === null || !('type' in data)) {
    return false
  }

  const eventType = (data as { type?: unknown }).type
  return typeof eventType === 'string' && allowedWhatsAppEvents.includes(eventType as WhatsAppEventType)
}

const api = {
  onWhatsAppEvent: (callback: WhatsAppEventCallback): (() => void) => {
    const listener = (event: IpcRendererEvent, data: unknown): void => {
      if (!isValidWhatsAppEvent(data)) {
        return
      }

      callback(event, data)
    }

    ipcRenderer.on('whatsapp-event', listener)

    return () => {
      ipcRenderer.removeListener('whatsapp-event', listener)
    }
  },
  iniciarConexao: (): void => ipcRenderer.send('whatsapp-init'),
  desconectar: (): void => ipcRenderer.send('whatsapp-logout'),
  getTemplates: (): Promise<TemplateRecord[]> => ipcRenderer.invoke('db-get-templates'),
  saveTemplate: (template: TemplatePayload): Promise<TemplateRecord> =>
    ipcRenderer.invoke('db-save-template', template),
  deleteTemplate: (id: string): Promise<boolean> => ipcRenderer.invoke('db-delete-template', id),
  getCampaigns: (): Promise<CampaignRecord[]> => ipcRenderer.invoke('db-get-campaigns'),
  createCampaign: (campaign: CampaignPayload, contacts: CampaignContactPayload[]): Promise<CampaignRecord> =>
    ipcRenderer.invoke('db-create-campaign', campaign, contacts),
  getCampaignContacts: (campaignId: string): Promise<CampaignContactRecord[]> =>
    ipcRenderer.invoke('db-get-campaign-contacts', campaignId),
  finishCampaign: (
    campaignId: string,
    status: string,
    sentCount: number,
    successCount: number,
    failedCount: number
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      'db-finish-campaign',
      campaignId,
      status,
      sentCount,
      successCount,
      failedCount
    )
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
