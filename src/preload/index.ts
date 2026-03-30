import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type WhatsAppEventType = 'qr' | 'ready' | 'authenticated' | 'disconnected'

type WhatsAppEventData = {
  type: WhatsAppEventType
  payload?: unknown
}

type WhatsAppEventCallback = (event: IpcRendererEvent, data: WhatsAppEventData) => void
const allowedWhatsAppEvents: WhatsAppEventType[] = ['qr', 'ready', 'authenticated', 'disconnected']

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
  desconectar: (): void => ipcRenderer.send('whatsapp-logout')
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
