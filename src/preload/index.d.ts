import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcRendererEvent } from 'electron'

type WhatsAppEventType = 'qr' | 'ready' | 'authenticated' | 'disconnected'

type WhatsAppEventData = {
  type: WhatsAppEventType
  payload?: unknown
}

type WhatsAppEventCallback = (event: IpcRendererEvent, data: WhatsAppEventData) => void

interface AppAPI {
  onWhatsAppEvent: (callback: WhatsAppEventCallback) => () => void
  iniciarConexao: () => void
  desconectar: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
