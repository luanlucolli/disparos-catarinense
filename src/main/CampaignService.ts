import type { Client } from 'whatsapp-web.js'
import {
  finishCampaign,
  getCampaignById,
  getCampaignsByStatus,
  getOldestCampaignByStatus,
  getPendingCampaignContacts,
  updateCampaignContactStatus,
  updateCampaignPayload,
  updateCampaignProgress,
  updateCampaignStatus,
  type CampaignContactRecord,
  type CampaignRecord
} from './database'
import { compileMessageForContact } from './MessageParser'

const SCHEDULER_INTERVAL_MS = 60_000
const SCHEDULER_TOLERANCE_MS = 180_000
const OFFLINE_SCHEDULE_FAILURE_LOG =
  '[Sistema] Campanha cancelada: O aplicativo estava fechado no horário agendado.'
const SHUTDOWN_FAILURE_LOG =
  '[Sistema] Campanha cancelada: O aplicativo foi fechado.'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

type CampaignState = {
  campaignId: string
  running: boolean
  paused: boolean
  cancelled: boolean
  isShuttingDown?: boolean // Flag de segurança para evitar duplos logs no fechamento
  sent: number
  success: number
  failed: number
  pauseResolvers: Array<() => void>
}

export type CampaignServiceConfig = {
  minDelay: number
  maxDelay: number
  cooldownEnabled: boolean
  cooldownMinutes: number
  cooldownEvery: number
  simulateTyping?: boolean
  scheduled?: boolean
  scheduleDate?: string | Date | null
  scheduleHour?: string
  scheduleMinute?: string
}

export type CampaignProgressEvent = {
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

type CampaignServiceDependencies = {
  getClient: () => Client | null
  isClientReady: () => boolean
  emitProgress: (event: CampaignProgressEvent) => void
}

type ContactResult = {
  status: 'success' | 'failed'
  log: string
  contactStatus: string
  errorLog: string | null
}

const formatClock = (date: Date): string => {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

const formatDateTime = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hour}:${minute}`
}

const nowTag = (): string => `[${formatClock(new Date())}]`

const safeMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}

const toPositiveNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return numeric
}

const parseClockUnit = (value: unknown, fallback: number, max: number): number => {
  const numeric = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback
  }
  return Math.min(max, numeric)
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export class CampaignService {
  private campaigns = new Map<string, CampaignState>()
  private schedulerInterval: NodeJS.Timeout | null = null

  constructor(private readonly dependencies: CampaignServiceDependencies) {}

  initScheduler(): void {
    if (this.schedulerInterval) {
      return
    }

    const crashResidualCampaigns = [
      ...getCampaignsByStatus('Em andamento'),
      ...getCampaignsByStatus('Aguardando'),
      ...getCampaignsByStatus('Agendado')
    ]

    for (const campaign of crashResidualCampaigns) {
      this.failCampaignByAppShutdown(campaign)
    }

    this.schedulerInterval = setInterval(() => {
      void this.runSchedulerTick()
    }, SCHEDULER_INTERVAL_MS)

    // O tick já roda processNextInQueue, então removemos a chamada redundante aqui.
    void this.runSchedulerTick()
  }

  hasPendingOrRunningCampaigns(): boolean {
    const hasRunningInMemory = Array.from(this.campaigns.values()).some(
      (campaignState) => campaignState.running && !campaignState.paused
    )
    if (hasRunningInMemory) {
      return true
    }

    return getCampaignsByStatus('Aguardando').length > 0 || getCampaignsByStatus('Agendado').length > 0
  }

  async cancelAllActiveCampaigns(): Promise<void> {
    const activeCampaigns = Array.from(this.campaigns.values()).filter(
      (campaignState) => campaignState.running
    )

    for (const runtime of activeCampaigns) {
      runtime.isShuttingDown = true // Informa ao finally() para não agir duplamente
      runtime.cancelled = true
      runtime.paused = false
      this.resolvePause(runtime)

      const campaign = getCampaignById(runtime.campaignId)

      if (campaign) {
        finishCampaign(runtime.campaignId, 'Falhou', runtime.sent, runtime.success, runtime.failed)
      }

      this.emit(runtime, {
        status: 'Falhou',
        log: `${nowTag()} 🛑 ${SHUTDOWN_FAILURE_LOG}`,
        finishedAt: new Date().toISOString()
      })

      console.info(`[campaign] Campanha ${runtime.campaignId} cancelada forçadamente pelo fechamento do app.`)
    }

    const pendingCampaigns = [
      ...getCampaignsByStatus('Aguardando'),
      ...getCampaignsByStatus('Agendado')
    ]

    for (const campaign of pendingCampaigns) {
      this.failCampaignByAppShutdown(campaign)
    }
  }

  async enqueueCampaign(
    campaignId: string,
    config?: CampaignServiceConfig | null,
    messages?: unknown[] | null
  ): Promise<boolean> {
    const campaign = getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campanha não encontrada no banco local.')
    }

    const resolvedConfig = this.normalizeConfig(config ?? campaign.config)
    const resolvedMessages = this.normalizeMessages(messages ?? campaign.messages)

    if (resolvedMessages.length === 0) {
      throw new Error('Nenhuma mensagem válida foi encontrada para enfileirar a campanha.')
    }

    updateCampaignPayload(campaignId, resolvedConfig, resolvedMessages)

    const scheduledAt = this.resolveScheduledDate(resolvedConfig)
    if (scheduledAt && scheduledAt.getTime() > Date.now()) {
      updateCampaignStatus(campaignId, 'Agendado')
      this.emitDetachedProgress(campaign, {
        status: 'Agendado',
        log: `${nowTag()} 📅 Campanha agendada para ${formatDateTime(scheduledAt)}.`
      })
      return true
    }

    if (this.hasAnotherRunningCampaign(campaignId)) {
      updateCampaignStatus(campaignId, 'Aguardando')
      this.emitDetachedProgress(campaign, {
        status: 'Aguardando',
        log: `${nowTag()} 🕒 Campanha adicionada à fila de envio.`
      })
      return true
    }

    return this.startCampaign(campaignId, resolvedConfig, resolvedMessages)
  }

  async startCampaign(
    campaignId: string,
    config?: CampaignServiceConfig | null,
    messages?: unknown[] | null
  ): Promise<boolean> {
    const existing = this.campaigns.get(campaignId)
    if (existing?.running) {
      throw new Error('Esta campanha já está em execução.')
    }

    if (this.hasAnotherRunningCampaign(campaignId)) {
      throw new Error('Já existe uma campanha em execução. Pause ou aguarde a conclusão dela antes de iniciar outra.')
    }

    const campaign = getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campanha não encontrada no banco local.')
    }

    const resolvedConfig = this.normalizeConfig(config ?? campaign.config)
    const resolvedMessages = this.normalizeMessages(messages ?? campaign.messages)

    if (resolvedMessages.length === 0) {
      throw new Error('Nenhuma mensagem válida foi enviada para iniciar a campanha.')
    }

    if (!this.isReadyForDispatch()) {
      throw new Error('Cliente WhatsApp ainda não está pronto. Conecte-se e aguarde o status "Pronto".')
    }

    updateCampaignPayload(campaignId, resolvedConfig, resolvedMessages)

    const runtime: CampaignState = {
      campaignId,
      running: true,
      paused: false,
      cancelled: false,
      sent: campaign.sent_count ?? 0,
      success: campaign.success_count ?? 0,
      failed: campaign.failed_count ?? 0,
      pauseResolvers: []
    }

    this.campaigns.set(campaignId, runtime)

    updateCampaignStatus(runtime.campaignId, 'Em andamento')
    this.emit(runtime, {
      status: 'Em andamento',
      log: `${nowTag()} 🚀 Processamento de campanha iniciado.`
    })

    void this.runCampaign(runtime, resolvedConfig, resolvedMessages)
    return true
  }

  async pauseCampaign(campaignId: string): Promise<boolean> {
    const runtime = this.campaigns.get(campaignId)

    if (runtime && runtime.running) {
      runtime.paused = true
      updateCampaignStatus(campaignId, 'Pausado')
      this.emit(runtime, {
        status: 'Pausado',
        log: `${nowTag()} ⏸️ Campanha pausada.`
      })
      
      // CORREÇÃO: Se eu pausei esta, o motor ficou livre. Puxo imediatamente a próxima da fila!
      void this.processNextInQueue()
      return true
    }

    return updateCampaignStatus(campaignId, 'Pausado')
  }

  async resumeCampaign(campaignId: string): Promise<boolean> {
    if (this.hasAnotherRunningCampaign(campaignId)) {
      throw new Error('Já existe uma campanha em execução. Pause ou aguarde a conclusão dela antes de iniciar outra.')
    }

    const runtime = this.campaigns.get(campaignId)

    if (runtime && runtime.running) {
      runtime.paused = false
      this.resolvePause(runtime)
      updateCampaignStatus(campaignId, 'Em andamento')
      this.emit(runtime, {
        status: 'Em andamento',
        log: `${nowTag()} ▶️ Campanha retomada.`
      })
      return true
    }

    const campaign = getCampaignById(campaignId)
    if (!campaign) {
      return false
    }

    if (campaign.status !== 'Pausado') {
      throw new Error('Esta campanha não está pausada.')
    }

    const storedConfig = this.normalizeConfig(campaign.config)
    const storedMessages = this.normalizeMessages(campaign.messages)

    if (storedMessages.length === 0) {
      throw new Error('Esta campanha não possui mensagens válidas para retomar.')
    }

    return this.startCampaign(campaignId, storedConfig, storedMessages)
  }

  async cancelCampaign(campaignId: string): Promise<boolean> {
    const runtime = this.campaigns.get(campaignId)

    if (runtime && runtime.running) {
      runtime.cancelled = true
      runtime.paused = false
      this.resolvePause(runtime)
      this.emit(runtime, {
        status: 'Falhou',
        log: `${nowTag()} 🛑 Cancelamento solicitado pelo usuário.`
      })
      return true
    }

    const campaign = getCampaignById(campaignId)
    if (!campaign) {
      return false
    }

    finishCampaign(
      campaignId,
      'Falhou',
      campaign.sent_count ?? 0,
      campaign.success_count ?? 0,
      campaign.failed_count ?? 0
    )

    this.emitDetachedProgress(campaign, {
      status: 'Falhou',
      log: `${nowTag()} ❌ Campanha cancelada.`,
      finishedAt: new Date().toISOString()
    })

    return true
  }

  async processNextInQueue(): Promise<boolean> {
    if (this.hasAnotherRunningCampaign()) {
      return false
    }

    if (!this.isReadyForDispatch()) {
      return false
    }

    while (!this.hasAnotherRunningCampaign()) {
      const nextCampaign = getOldestCampaignByStatus('Aguardando')

      if (!nextCampaign) {
        return false
      }

      const nextConfig = this.normalizeConfig(nextCampaign.config)
      const nextMessages = this.normalizeMessages(nextCampaign.messages)

      if (nextMessages.length === 0) {
        finishCampaign(
          nextCampaign.id,
          'Falhou',
          nextCampaign.sent_count ?? 0,
          nextCampaign.success_count ?? 0,
          nextCampaign.failed_count ?? 0
        )

        this.emitDetachedProgress(nextCampaign, {
          status: 'Falhou',
          log: `${nowTag()} ❌ Campanha removida da fila: nenhuma mensagem válida encontrada.`,
          finishedAt: new Date().toISOString()
        })
        continue
      }

      try {
        return await this.startCampaign(nextCampaign.id, nextConfig, nextMessages)
      } catch (error) {
        const errorMessage = safeMessage(error)

        if (
          errorMessage.includes('Cliente WhatsApp indisponível') ||
          errorMessage.includes('ainda não está pronto') ||
          errorMessage.includes('Já existe uma campanha em execução') ||
          errorMessage.includes('Esta campanha já está em execução')
        ) {
          return false
        }

        finishCampaign(
          nextCampaign.id,
          'Falhou',
          nextCampaign.sent_count ?? 0,
          nextCampaign.success_count ?? 0,
          nextCampaign.failed_count ?? 0
        )

        this.emitDetachedProgress(nextCampaign, {
          status: 'Falhou',
          log: `${nowTag()} ❌ Erro ao iniciar campanha da fila: ${errorMessage}`,
          finishedAt: new Date().toISOString()
        })
      }
    }

    return false
  }

  private async runCampaign(
    runtime: CampaignState,
    config: CampaignServiceConfig,
    messages: unknown[]
  ): Promise<void> {
    let finalStatus: 'Concluído' | 'Falhou' | null = null
    let finalLog = ''

    try {
      if (runtime.cancelled) {
        finalStatus = 'Falhou'
        finalLog = `${nowTag()} ❌ Campanha cancelada antes do disparo.`
        return
      }

      const pendingContacts = getPendingCampaignContacts(runtime.campaignId)
      if (pendingContacts.length === 0) {
        finalStatus = 'Concluído'
        finalLog = `${nowTag()} ✅ Nenhum contato pendente. Campanha concluída.`
        return
      }

      for (let index = 0; index < pendingContacts.length; index += 1) {
        const contact = pendingContacts[index]

        if (runtime.cancelled) break

        if (!this.dependencies.isClientReady()) {
          finalStatus = 'Falhou'
          finalLog = `${nowTag()} ❌ Falha Crítica: WhatsApp foi desconectado (Sessão Encerrada ou Sem Internet) durante o envio.`
          break
        }

        await this.waitIfPaused(runtime)
        if (runtime.cancelled) break

        const result = await this.processContact(runtime, contact, config, messages)

        runtime.sent += 1
        if (result.status === 'success') {
          runtime.success += 1
        } else {
          runtime.failed += 1
        }

        updateCampaignProgress(runtime.campaignId, runtime.sent, runtime.success, runtime.failed)

        this.emit(runtime, {
          contactId: contact.id,
          contactName: contact.name,
          contactNumber: contact.number,
          contactStatus: result.contactStatus,
          error: result.errorLog,
          log: result.log
        })

        if (runtime.cancelled) break

        if (index < pendingContacts.length - 1) {
          const randomDelay = this.randomBetweenSeconds(config.minDelay, config.maxDelay)
          await this.delayWithControls(runtime, randomDelay * 1000)
        }

        const cooldownEvery = toPositiveNumber(config.cooldownEvery, 20)
        const cooldownMinutes = toPositiveNumber(config.cooldownMinutes, 5)

        if (
          config.cooldownEnabled &&
          cooldownEvery > 0 &&
          runtime.sent > 0 &&
          runtime.sent % cooldownEvery === 0 &&
          index < pendingContacts.length - 1
        ) {
          this.emit(runtime, {
            status: runtime.paused ? 'Pausado' : 'Em andamento',
            log: `${nowTag()} 💤 Pausa estratégica de ${cooldownMinutes} minuto(s).`
          })
          await this.delayWithControls(runtime, cooldownMinutes * 60 * 1000)
        }
      }

      if (!finalStatus && !runtime.isShuttingDown) {
        if (runtime.cancelled) {
          finalStatus = 'Falhou'
          finalLog = `${nowTag()} ❌ Campanha cancelada pelo usuário.`
        } else {
          finalStatus = 'Concluído'
          finalLog = `${nowTag()} ✅ Todos os contatos processados.`
        }
      }
    } catch (error) {
      if (!runtime.isShuttingDown) {
        finalStatus = 'Falhou'
        finalLog = `${nowTag()} ❌ Erro fatal da campanha: ${safeMessage(error)}`
        console.error('[campaign] Erro fatal no loop da campanha:', error)
      }
    } finally {
      runtime.running = false
      runtime.paused = false
      this.resolvePause(runtime)
      this.campaigns.delete(runtime.campaignId)

      // CORREÇÃO: Impede salvar no banco e emitir redundância se o evento
      // foi disparado pela função cancelAllActiveCampaigns (app fechando).
      if (finalStatus && !runtime.isShuttingDown) {
        finishCampaign(runtime.campaignId, finalStatus, runtime.sent, runtime.success, runtime.failed)
        this.emit(runtime, {
          status: finalStatus,
          log: finalLog,
          finishedAt: new Date().toISOString()
        })
      }

      if (!runtime.isShuttingDown) {
        try {
          await this.processNextInQueue()
        } catch (queueError) {
          console.error('[campaign] Erro ao processar próxima campanha da fila:', queueError)
        }
      }
    }
  }

  private async runSchedulerTick(): Promise<void> {
    try {
      const scheduledCampaigns = getCampaignsByStatus('Agendado')
      const now = Date.now()
      let queueUpdated = false

      for (const campaign of scheduledCampaigns) {
        const config = this.normalizeConfig(campaign.config)
        const scheduledDate = this.resolveScheduledDate(config)

        if (!scheduledDate) {
          finishCampaign(
            campaign.id,
            'Falhou',
            campaign.sent_count ?? 0,
            campaign.success_count ?? 0,
            campaign.failed_count ?? 0
          )
          this.emitDetachedProgress(campaign, {
            status: 'Falhou',
            log: `${nowTag()} ❌ Campanha cancelada: configuração de agendamento inválida.`,
            finishedAt: new Date().toISOString()
          })
          continue
        }

        const scheduledAt = scheduledDate.getTime()
        const delayAfterSchedule = now - scheduledAt

        if (delayAfterSchedule > SCHEDULER_TOLERANCE_MS) {
          finishCampaign(
            campaign.id,
            'Falhou',
            campaign.sent_count ?? 0,
            campaign.success_count ?? 0,
            campaign.failed_count ?? 0
          )
          this.emitDetachedProgress(campaign, {
            status: 'Falhou',
            log: `${nowTag()} ${OFFLINE_SCHEDULE_FAILURE_LOG}`,
            finishedAt: new Date().toISOString()
          })
          continue
        }

        if (scheduledAt <= now + 1000) {
          updateCampaignStatus(campaign.id, 'Aguardando')
          this.emitDetachedProgress(campaign, {
            status: 'Aguardando',
            log: `${nowTag()} ⏰ Horário atingido. Campanha movida para a fila.`
          })
          queueUpdated = true
        }
      }

      if (queueUpdated || !this.hasAnotherRunningCampaign()) {
        await this.processNextInQueue()
      }
    } catch (error) {
      console.error('[campaign] Erro no scheduler de campanhas:', error)
    }
  }

  private async processContact(
    runtime: CampaignState,
    contact: CampaignContactRecord,
    config: CampaignServiceConfig,
    messages: unknown[]
  ): Promise<ContactResult> {
    const client = this.dependencies.getClient()
    if (!client) {
      const errorLog = 'Cliente WhatsApp indisponível.'
      updateCampaignContactStatus(contact.id, 'failed', errorLog)
      return {
        status: 'failed',
        contactStatus: 'failed',
        errorLog,
        log: `${nowTag()} ❌ ${contact.name || 'Sem nome'} (${contact.number}): ${errorLog}`
      }
    }

    const normalizedNumber = this.normalizePhone(contact.number)
    if (!normalizedNumber) {
      const errorLog = 'Número inválido.'
      updateCampaignContactStatus(contact.id, 'failed', errorLog)
      return {
        status: 'failed',
        contactStatus: 'failed',
        errorLog,
        log: `${nowTag()} ❌ ${contact.name || 'Sem nome'} (${contact.number}): ${errorLog}`
      }
    }

    const formattedNumber = `${normalizedNumber}@c.us`

    try {
      const numberId = await client.getNumberId(formattedNumber)
      const targetId = numberId?._serialized ?? formattedNumber

      if (!numberId) {
        const errorLog = 'Não possui WhatsApp.'
        updateCampaignContactStatus(contact.id, 'failed', errorLog)
        return {
          status: 'failed',
          contactStatus: 'failed',
          errorLog,
          log: `${nowTag()} ❌ ${contact.name || 'Sem nome'} (${contact.number}): ${errorLog}`
        }
      }

      const randomMessage = messages[Math.floor(Math.random() * messages.length)]
      const parsedMessage = compileMessageForContact(randomMessage, contact.name)
      const finalMessage = parsedMessage || 'Olá!'

      if (config.simulateTyping) {
        const typingDelay = this.calculateTypingDelay(finalMessage)
        const shouldShowTyping = Math.random() > 0.3

        if (shouldShowTyping) {
          try {
            const chat = await client.getChatById(targetId)
            await chat.sendStateTyping()
          } catch (typingError) {
            console.warn('[campaign] Falha ao simular digitação:', typingError)
          }
        }

        await this.delayWithControls(runtime, typingDelay)
      }

      await client.sendMessage(targetId, finalMessage, {
        linkPreview: false, 
        waitUntilMsgSent: true
      })

      updateCampaignContactStatus(contact.id, 'success', null)

      return {
        status: 'success',
        contactStatus: 'success',
        errorLog: null,
        log: `${nowTag()} ✅ Enviado — ${contact.name || 'Sem nome'} (${contact.number})`
      }
    } catch (error) {
      const errorLog = safeMessage(error)
      updateCampaignContactStatus(contact.id, 'failed', errorLog)
      return {
        status: 'failed',
        contactStatus: 'failed',
        errorLog,
        log: `${nowTag()} ❌ Erro de Envio — ${contact.name || 'Sem nome'} (${contact.number}): ${errorLog}`
      }
    }
  }

  private emit(
    runtime: CampaignState,
    payload: Omit<CampaignProgressEvent, 'campaignId' | 'sent' | 'success' | 'failed'>
  ): void {
    this.dependencies.emitProgress({
      campaignId: runtime.campaignId,
      sent: runtime.sent,
      success: runtime.success,
      failed: runtime.failed,
      ...payload
    })
  }

  private emitDetachedProgress(
    campaign: Pick<CampaignRecord, 'id' | 'sent_count' | 'success_count' | 'failed_count'>,
    payload: Omit<CampaignProgressEvent, 'campaignId' | 'sent' | 'success' | 'failed'>
  ): void {
    this.dependencies.emitProgress({
      campaignId: campaign.id,
      sent: campaign.sent_count ?? 0,
      success: campaign.success_count ?? 0,
      failed: campaign.failed_count ?? 0,
      ...payload
    })
  }

  private failCampaignByAppShutdown(
    campaign: Pick<CampaignRecord, 'id' | 'sent_count' | 'success_count' | 'failed_count'>
  ): void {
    finishCampaign(
      campaign.id,
      'Falhou',
      campaign.sent_count ?? 0,
      campaign.success_count ?? 0,
      campaign.failed_count ?? 0
    )

    this.emitDetachedProgress(campaign, {
      status: 'Falhou',
      log: `${nowTag()} 🛑 ${SHUTDOWN_FAILURE_LOG}`,
      finishedAt: new Date().toISOString()
    })

    console.info(`[campaign] Campanha ${campaign.id} cancelada: aplicativo encerrado com disparo pendente.`)
  }

  private hasAnotherRunningCampaign(campaignId?: string): boolean {
    return Array.from(this.campaigns.values()).some((campaignState) => {
      const sameCampaign = campaignId ? campaignState.campaignId === campaignId : false
      return campaignState.running && !campaignState.paused && !sameCampaign
    })
  }

  private isReadyForDispatch(): boolean {
    return Boolean(this.dependencies.getClient()) && this.dependencies.isClientReady()
  }

  private normalizeConfig(config: unknown): CampaignServiceConfig {
    const source = isObjectRecord(config) ? (config as Partial<CampaignServiceConfig>) : {}

    const rawMin = toPositiveNumber(source.minDelay, 15)
    const rawMax = toPositiveNumber(source.maxDelay, 30)
    const minDelay = Math.min(rawMin, rawMax)
    const maxDelay = Math.max(rawMin, rawMax)

    const scheduleDate = source.scheduleDate ?? null
    const scheduleHour = String(parseClockUnit(source.scheduleHour, 9, 23)).padStart(2, '0')
    const scheduleMinute = String(parseClockUnit(source.scheduleMinute, 0, 59)).padStart(2, '0')

    return {
      minDelay,
      maxDelay,
      cooldownEnabled: Boolean(source.cooldownEnabled),
      cooldownMinutes: toPositiveNumber(source.cooldownMinutes, 5),
      cooldownEvery: toPositiveNumber(source.cooldownEvery, 20),
      simulateTyping: source.simulateTyping !== false,
      scheduled: Boolean(source.scheduled),
      scheduleDate,
      scheduleHour,
      scheduleMinute
    }
  }

  private normalizeMessages(messages: unknown): unknown[] {
    if (!Array.isArray(messages)) {
      return []
    }
    return messages.filter((message) => {
      if (message === null || message === undefined) return false
      if (typeof message === 'string') return message.trim().length > 0
      return true
    })
  }

  private resolvePause(runtime: CampaignState): void {
    const resolvers = runtime.pauseResolvers.splice(0)
    for (const resolve of resolvers) {
      resolve()
    }
  }

  private async waitIfPaused(runtime: CampaignState): Promise<void> {
    while (runtime.paused && !runtime.cancelled) {
      await new Promise<void>((resolve) => {
        runtime.pauseResolvers.push(resolve)
      })
    }
  }

  private async delayWithControls(runtime: CampaignState, totalMs: number): Promise<void> {
    let remainingMs = Math.max(0, totalMs)

    while (remainingMs > 0) {
      if (runtime.cancelled || runtime.isShuttingDown) return // Previne travamento no fechamento
      await this.waitIfPaused(runtime)
      if (runtime.cancelled || runtime.isShuttingDown) return

      const step = Math.min(remainingMs, 500)
      await sleep(step)
      remainingMs -= step
    }
  }

  private resolveScheduledDate(config: CampaignServiceConfig): Date | null {
    if (!config.scheduled || !config.scheduleDate) {
      return null
    }

    const scheduleBase = new Date(config.scheduleDate)
    if (Number.isNaN(scheduleBase.getTime())) {
      return null
    }

    const hour = parseClockUnit(config.scheduleHour, 0, 23)
    const minute = parseClockUnit(config.scheduleMinute, 0, 59)

    const scheduledTime = new Date(scheduleBase)
    scheduledTime.setHours(hour, minute, 0, 0)

    return scheduledTime
  }

  private randomBetweenSeconds(minDelay: number, maxDelay: number): number {
    const min = Math.floor(Math.min(toPositiveNumber(minDelay, 10), toPositiveNumber(maxDelay, 20)))
    const max = Math.floor(Math.max(toPositiveNumber(minDelay, 10), toPositiveNumber(maxDelay, 20)))

    if (max <= min) {
      return min
    }

    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  private normalizePhone(rawNumber: string): string | null {
    const digits = String(rawNumber ?? '').replace(/\D/g, '')

    if (!digits || digits.length < 10) {
      return null
    }

    const withCountryCode = digits.startsWith('55') ? digits : `55${digits}`
    return withCountryCode
  }

  private calculateTypingDelay(message: string): number {
    return Math.max(1500, Math.min(12000, message.length * 50))
  }
}