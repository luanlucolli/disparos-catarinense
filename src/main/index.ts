import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { execFile } from 'child_process'
import { rmSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { Client, LocalAuth } from 'whatsapp-web.js'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  getCampaigns,
  createCampaign,
  getCampaignContacts,
  finishCampaign,
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

function setupWhatsApp(mainWindow: BrowserWindow): void {
  let isInitializing = false
  let isClientStarted = false
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
      isClientStarted = false
      sendWhatsAppEvent({ type: 'disconnected', payload: reason })

      // CORREÇÃO: Limpa o cliente morto e a sessão local, já que o acesso foi revogado na Meta
      await resetClient(true)
    })

    clientInstance.on('auth_failure', async (message: string) => {
      if (client !== clientInstance) return
      console.error('[whatsapp] Falha de autenticação:', message)
      isClientStarted = false
      sendWhatsAppEvent({ type: 'disconnected', payload: message })

      // CORREÇÃO: Limpa o cliente e a sessão inválida
      await resetClient(true)
    })

    return clientInstance
  }

  const destroyCurrentClient = async (): Promise<void> => {
    if (!client) return
    try {
      // Dá tempo ao Puppeteer para encerrar graciosamente (evita o Target closed error)
      await client.destroy()
      console.info('[whatsapp] Navegador invisível encerrado graciosamente.')
    } catch (error) {
      console.warn('[whatsapp] Aviso ao destruir cliente atual:', error)
    } finally {
      client = null
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

      // CORREÇÃO CRÍTICA: Sempre passamos FALSE no catch de inicialização. 
      // Matamos o processo do Chrome que travou, mas preservamos a pasta de sessão.
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

    try {
      console.info('[whatsapp] Iniciando processo de LOGOUT real (Servidor + Local)...')

      const logoutPromise = client.logout()
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout atingido no servidor da Meta')), 10000)
      )

      await Promise.race([logoutPromise, timeoutPromise])
      console.info('[whatsapp] Logout remoto concluído com sucesso.')

      await destroyCurrentClient()
      await killChromiumSessionProcesses()
      clearSessionDirectory()

      isClientStarted = false
      sendWhatsAppEvent({ type: 'disconnected', payload: 'Você foi desconectado com sucesso.' })

    } catch (error) {
      console.error('[whatsapp] Erro ao tentar deslogar no servidor da Meta:', error)
      sendWhatsAppEvent({ type: 'ready', payload: lastUserInfo })

      dialog.showErrorBox(
        'Falha ao Desconectar',
        'Não foi possível finalizar a sessão no servidor do WhatsApp. Sua sessão local foi mantida. Tente desconectar direto pelo celular.'
      )
    }
  }

  const onWhatsAppInit = (): void => { void initializeWhatsAppClient() }
  const onWhatsAppLogout = (): void => { void logoutWhatsAppClient() }

  ipcMain.on('whatsapp-init', onWhatsAppInit)
  ipcMain.on('whatsapp-logout', onWhatsAppLogout)

  mainWindow.on('closed', () => {
    ipcMain.removeListener('whatsapp-init', onWhatsAppInit)
    ipcMain.removeListener('whatsapp-logout', onWhatsAppLogout)
  })

  // --- O NOVO MOTOR DE DESLIGAMENTO SEGURO ---
  app.on('before-quit', async (event) => {
    if (!isAppQuitting) {
      // 1. Pausa o fechamento do Windows
      event.preventDefault()
      isAppQuitting = true

      console.info('\n[sistema] Encerrando o aplicativo. Salvando sessão do WhatsApp com segurança...')

      // 2. Fecha o WhatsApp educadamente (salva os arquivos)
      await destroyCurrentClient()

      // 3. Varre qualquer lixo que sobrou para evitar arquivos travados
      await killChromiumSessionProcesses()
      clearChromiumSessionLocks()

      // 4. Libera o fechamento do aplicativo
      console.info('[sistema] Fechamento seguro concluído. Até logo!')
      app.quit()
    }
  })
}

let hasRegisteredDatabaseHandlers = false

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
      status: string,
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
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