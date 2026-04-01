import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { rmSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { Client, LocalAuth } from 'whatsapp-web.js'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CampaignService, type CampaignServiceConfig } from './CampaignService'
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  getCampaigns,
  createCampaign,
  getCampaignContacts,
  finishCampaign,
  type CampaignStatus,
  type CampaignInput,
  type CampaignContactInput,
  type TemplateInput
} from './database'

type WhatsAppEventType = 'qr' | 'ready' | 'authenticated' | 'disconnected'

type WhatsAppEventData = {
  type: WhatsAppEventType
  payload?: unknown
}

const WHATSAPP_INIT_TIMEOUT_MS = 90000
const execFileAsync = promisify(execFile)

// Flag global para o Desligamento Gracioso
let isAppQuitting = false
let currentMainWindow: BrowserWindow | null = null
let currentWhatsAppClient: Client | null = null

const campaignService = new CampaignService({
  getClient: () => currentWhatsAppClient,
  emitProgress: (event) => {
    if (!currentMainWindow || currentMainWindow.isDestroyed() || currentMainWindow.webContents.isDestroyed()) {
      return
    }

    currentMainWindow.webContents.send('campaign-progress', event)
  }
})

function setupWhatsApp(mainWindow: BrowserWindow): void {
  currentMainWindow = mainWindow

  let isInitializing = false
  let isClientStarted = false
  
  // NOVO: Trava para evitar conflito entre o Logout Manual e o Evento Automático
  let isLoggingOut = false 
  
  let client: Client | null = null

  // --- MEMÓRIA DE ESTADO ---
  let lastState: WhatsAppEventType = 'disconnected'
  let lastQrData: string = ''
  let lastUserInfo: unknown = undefined

  const sendWhatsAppEvent = (event: WhatsAppEventData): void => {
    lastState = event.type
    if (event.type === 'qr') lastQrData = event.payload as string
    if (event.type === 'ready') lastUserInfo = event.payload
    if (event.type === 'disconnected') {
      lastQrData = ''
      lastUserInfo = undefined
    }

    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('whatsapp-event', event)
  }

  const clearChromiumSessionLocks = (): void => {
    const sessionDir = join(app.getPath('userData'), 'whatsapp-auth', 'session')
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']

    for (const fileName of lockFiles) {
      try {
        rmSync(join(sessionDir, fileName), { force: true })
      } catch (error) {
        // Ignorado silenciosamente
      }
    }
  }

  const clearSessionDirectory = (): void => {
    const sessionDir = join(app.getPath('userData'), 'whatsapp-auth')
    try {
      rmSync(sessionDir, { recursive: true, force: true })
      console.warn('[whatsapp] Diretório de sessão local removido.')
    } catch (error) {
      console.warn('[whatsapp] Falha ao limpar diretório de sessão:', error)
    }
  }

  const killChromiumSessionProcesses = async (): Promise<void> => {
    const sessionDir = join(app.getPath('userData'), 'whatsapp-auth', 'session')

    try {
      if (process.platform === 'win32') {
        const escapedSessionDir = sessionDir.replace(/'/g, "''")
        const script = `
          $sessionDir = '${escapedSessionDir}'
          Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine -like "*$sessionDir*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        `
        await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
        return
      }
      await execFileAsync('pkill', ['-f', sessionDir])
    } catch {
      // Ignorado
    }
  }

  const assertWhatsAppWebReachable = async (): Promise<void> => {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch('https://web.whatsapp.com/', {
        method: 'GET',
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Sem acesso ao WhatsApp Web (https://web.whatsapp.com). Detalhe: ${reason}`)
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  const createClient = (): Client => {
    clearChromiumSessionLocks()

    const clientInstance = new Client({
      authStrategy: new LocalAuth({
        dataPath: join(app.getPath('userData'), 'whatsapp-auth')
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      }
    })

    clientInstance.on('qr', (qr: string) => {
      if (client !== clientInstance) return
      console.info('[whatsapp] QR recebido')
      sendWhatsAppEvent({ type: 'qr', payload: qr })
    })

    clientInstance.on('ready', () => {
      if (client !== clientInstance) return
      console.info('[whatsapp] Cliente pronto')
      const info = clientInstance.info;
      const payload = info ? { name: info.pushname, number: info.wid?.user } : undefined;
      sendWhatsAppEvent({ type: 'ready', payload })
      void campaignService.processNextInQueue()
    })

    clientInstance.on('authenticated', () => {
      if (client !== clientInstance) return
      console.info('[whatsapp] Cliente autenticado')
      sendWhatsAppEvent({ type: 'authenticated' })
    })

    clientInstance.on('loading_screen', (percent: string, message: string) => {
      if (client !== clientInstance) return
      console.info(`[whatsapp] Carregando sessão (${percent}%): ${message}`)
    })

    clientInstance.on('disconnected', async (reason: string) => {
      if (client !== clientInstance) return
      console.warn('[whatsapp] Cliente desconectado pelo celular:', reason)

      // CORREÇÃO: Se estamos no meio de um logout manual, ignoramos esse evento
      // para não tentar destruir o navegador duas vezes.
      if (isLoggingOut) {
        console.info('[whatsapp] Ignorando evento de desconexão pois um logout manual já está em andamento.')
        return
      }

      isClientStarted = false
      sendWhatsAppEvent({ type: 'disconnected', payload: reason })

      await resetClient(true)
    })

    clientInstance.on('auth_failure', async (message: string) => {
      if (client !== clientInstance) return
      console.error('[whatsapp] Falha de autenticação:', message)
      
      if (isLoggingOut) return

      isClientStarted = false
      sendWhatsAppEvent({ type: 'disconnected', payload: message })

      await resetClient(true)
    })

    currentWhatsAppClient = clientInstance

    return clientInstance
  }

  const destroyCurrentClient = async (): Promise<void> => {
    if (!client) return
    try {
      await client.destroy()
      console.info('[whatsapp] Navegador invisível encerrado graciosamente.')
    } catch (error) {
      console.warn('[whatsapp] Aviso ao destruir cliente atual:', error)
    } finally {
      client = null
      currentWhatsAppClient = null
    }
  }

  const resetClient = async (purgeSession = false): Promise<void> => {
    await destroyCurrentClient()
    await killChromiumSessionProcesses()
    if (purgeSession) clearSessionDirectory()
    clearChromiumSessionLocks()
    client = createClient()
  }

  const initializeWhatsAppClient = async (): Promise<void> => {
    if (isClientStarted && !isInitializing) {
      if (lastState === 'qr') sendWhatsAppEvent({ type: 'qr', payload: lastQrData })
      else if (lastState === 'ready') sendWhatsAppEvent({ type: 'ready', payload: lastUserInfo })
      else if (lastState === 'authenticated') sendWhatsAppEvent({ type: 'authenticated' })
      else if (lastState === 'disconnected') sendWhatsAppEvent({ type: 'disconnected' })
      return
    }

    if (isInitializing) return

    console.info('[whatsapp] Inicializando cliente')
    isInitializing = true
    isClientStarted = true
    isLoggingOut = false // Garante que a trava comece desativada

    let timeoutHandle: NodeJS.Timeout | undefined

    try {
      await assertWhatsAppWebReachable()

      if (!client) {
        await killChromiumSessionProcesses()
        client = createClient()
      }

      const activeClient = client
      const initializePromise = activeClient.initialize()
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('Tempo limite ao carregar sessão do WhatsApp. Verifique sua conexão com a internet ou se o WhatsApp Web está indisponível.'))
        }, WHATSAPP_INIT_TIMEOUT_MS)
      })

      await Promise.race([initializePromise, timeoutPromise])
    } catch (error) {
      console.error('[whatsapp] Erro ao inicializar:', error)
      isClientStarted = false

      const isTimeoutError = error instanceof Error && error.message.includes('Tempo limite')
      const messageBase = error instanceof Error ? error.message : 'Falha ao inicializar cliente do WhatsApp.'
      const message = isTimeoutError
        ? `${messageBase} A sessão foi mantida de forma segura. Verifique sua internet e tente clicar em Conectar novamente.`
        : messageBase

      sendWhatsAppEvent({ type: 'disconnected', payload: message })
      await resetClient(false)

    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      isInitializing = false
    }
  }

  const logoutWhatsAppClient = async (): Promise<void> => {
    if (!client) {
      sendWhatsAppEvent({ type: 'disconnected', payload: 'Nenhum cliente ativo para desconectar.' })
      return
    }

    if (isLoggingOut) return // Previne duplos cliques no React

    // Ativa a trava para silenciar os eventos automáticos
    isLoggingOut = true 

    try {
      console.info('[whatsapp] Iniciando processo de LOGOUT real (Servidor + Local)...')

      const logoutPromise = client.logout()
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout atingido no servidor da Meta')), 10000)
      )

      await Promise.race([logoutPromise, timeoutPromise])
      console.info('[whatsapp] Logout remoto concluído com sucesso.')

    } catch (error) {
      console.error('[whatsapp] Erro ao tentar deslogar no servidor da Meta:', error)
    } finally {
      // Limpeza local forçada em todos os cenários
      await destroyCurrentClient()
      await killChromiumSessionProcesses()
      clearSessionDirectory()

      isClientStarted = false
      isLoggingOut = false // Desativa a trava
      
      sendWhatsAppEvent({ type: 'disconnected', payload: 'Você foi desconectado com sucesso.' })
    }
  }

  const forceResetWhatsAppClient = async (): Promise<void> => {
    if (isAppQuitting) {
      return
    }

    try {
      isInitializing = false
      isClientStarted = false
      await resetClient(true)
      sendWhatsAppEvent({
        type: 'disconnected',
        payload: 'Sessão resetada com sucesso. Por favor, tente conectar novamente.'
      })
    } catch (error) {
      console.error('[whatsapp] Erro ao forçar reset da sessão:', error)
      sendWhatsAppEvent({
        type: 'disconnected',
        payload: 'Falha ao resetar a sessão. Tente novamente.'
      })
    }
  }

  const onWhatsAppInit = (): void => { void initializeWhatsAppClient() }
  const onWhatsAppLogout = (): void => { void logoutWhatsAppClient() }
  const onWhatsAppForceReset = (): void => { void forceResetWhatsAppClient() }

  ipcMain.on('whatsapp-init', onWhatsAppInit)
  ipcMain.on('whatsapp-logout', onWhatsAppLogout)
  ipcMain.on('whatsapp-force-reset', onWhatsAppForceReset)

  mainWindow.on('closed', () => {
    ipcMain.removeListener('whatsapp-init', onWhatsAppInit)
    ipcMain.removeListener('whatsapp-logout', onWhatsAppLogout)
    ipcMain.removeListener('whatsapp-force-reset', onWhatsAppForceReset)

    if (currentMainWindow === mainWindow) {
      currentMainWindow = null
    }
  })

  // --- O NOVO MOTOR DE DESLIGAMENTO SEGURO ---
  app.on('before-quit', async (event) => {
    if (!isAppQuitting) {
      event.preventDefault()
      isAppQuitting = true

      console.info('\n[sistema] Encerrando o aplicativo. Salvando sessão do WhatsApp com segurança...')

      await destroyCurrentClient()
      await killChromiumSessionProcesses()
      clearChromiumSessionLocks()

      console.info('[sistema] Fechamento seguro concluído. Até logo!')
      app.quit()
    }
  })
}

let hasRegisteredDatabaseHandlers = false
let hasRegisteredCampaignHandlers = false

function throwIpcDatabaseError(channel: string, error: unknown): never {
  console.error(`[ipc][${channel}] Erro no banco de dados:`, error)
  const message = error instanceof Error ? error.message : 'Erro interno ao acessar o banco de dados.'
  throw new Error(message)
}

function registerDatabaseIpcHandlers(): void {
  if (hasRegisteredDatabaseHandlers) {
    return
  }

  hasRegisteredDatabaseHandlers = true

  ipcMain.handle('db-get-templates', async () => {
    try {
      return getTemplates()
    } catch (error) {
      return throwIpcDatabaseError('db-get-templates', error)
    }
  })

  ipcMain.handle('db-save-template', async (_, template: TemplateInput) => {
    try {
      return saveTemplate(template)
    } catch (error) {
      return throwIpcDatabaseError('db-save-template', error)
    }
  })

  ipcMain.handle('db-delete-template', async (_, id: string) => {
    try {
      return deleteTemplate(id)
    } catch (error) {
      return throwIpcDatabaseError('db-delete-template', error)
    }
  })

  ipcMain.handle('db-get-campaigns', async () => {
    try {
      return getCampaigns()
    } catch (error) {
      return throwIpcDatabaseError('db-get-campaigns', error)
    }
  })

  ipcMain.handle('db-create-campaign', async (_, campaign: CampaignInput, contacts: CampaignContactInput[]) => {
    try {
      return createCampaign(campaign, contacts)
    } catch (error) {
      return throwIpcDatabaseError('db-create-campaign', error)
    }
  })

  ipcMain.handle('db-get-campaign-contacts', async (_, campaignId: string) => {
    try {
      return getCampaignContacts(campaignId)
    } catch (error) {
      return throwIpcDatabaseError('db-get-campaign-contacts', error)
    }
  })

  ipcMain.handle(
    'db-finish-campaign',
    async (
      _,
      campaignId: string,
      status: CampaignStatus,
      sentCount: number,
      successCount: number,
      failedCount: number
    ) => {
      try {
        return finishCampaign(campaignId, status, sentCount, successCount, failedCount)
      } catch (error) {
        return throwIpcDatabaseError('db-finish-campaign', error)
      }
    }
  )
}

function throwIpcCampaignError(channel: string, error: unknown): never {
  console.error(`[ipc][${channel}] Erro no motor de campanha:`, error)
  const message =
    error instanceof Error ? error.message : 'Erro interno ao controlar o motor de campanhas.'
  throw new Error(message)
}

function registerCampaignIpcHandlers(): void {
  if (hasRegisteredCampaignHandlers) {
    return
  }

  hasRegisteredCampaignHandlers = true

  ipcMain.handle(
    'enqueue-campaign',
    async (_, campaignId: string, config: CampaignServiceConfig, messages: unknown[]) => {
      try {
        return await campaignService.enqueueCampaign(campaignId, config, messages)
      } catch (error) {
        return throwIpcCampaignError('enqueue-campaign', error)
      }
    }
  )

  ipcMain.handle(
    'start-campaign',
    async (_, campaignId: string, config: CampaignServiceConfig, messages: unknown[]) => {
      try {
        return await campaignService.startCampaign(campaignId, config, messages)
      } catch (error) {
        return throwIpcCampaignError('start-campaign', error)
      }
    }
  )

  ipcMain.handle('pause-campaign', async (_, campaignId: string) => {
    try {
      return await campaignService.pauseCampaign(campaignId)
    } catch (error) {
      return throwIpcCampaignError('pause-campaign', error)
    }
  })

  ipcMain.handle('resume-campaign', async (_, campaignId: string) => {
    try {
      return await campaignService.resumeCampaign(campaignId)
    } catch (error) {
      return throwIpcCampaignError('resume-campaign', error)
    }
  })

  ipcMain.handle('cancel-campaign', async (_, campaignId: string) => {
    try {
      return await campaignService.cancelCampaign(campaignId)
    } catch (error) {
      return throwIpcCampaignError('cancel-campaign', error)
    }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  setupWhatsApp(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDatabaseIpcHandlers()
  registerCampaignIpcHandlers()
  campaignService.initScheduler()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
