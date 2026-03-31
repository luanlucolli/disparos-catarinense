import type { Client } from 'whatsapp-web.js'
import {
  finishCampaign,
  getCampaignById,
  getPendingCampaignContacts,
  updateCampaignContactStatus,
  updateCampaignProgress,
  updateCampaignStatus,
  type CampaignContactRecord
} from './database'
import { compileMessageForContact } from './MessageParser'

// Serviço de fila em memória: controla start/pause/resume/cancel e sincroniza progresso no SQLite + IPC.
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

type CampaignState = {
  campaignId: string
  running: boolean
  paused: boolean
  cancelled: boolean
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
  waitLinkPreview?: boolean
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

export class CampaignService {
  private campaigns = new Map<string, CampaignState>()

  constructor(private readonly dependencies: CampaignServiceDependencies) {}

  async startCampaign(campaignId: string, config: CampaignServiceConfig, messages: unknown[]): Promise<boolean> {
    const existing = this.campaigns.get(campaignId)
    if (existing?.running) {
      throw new Error('Esta campanha já está em execução.')
    }

    const campaign = getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campanha não encontrada no banco local.')
    }

    if (!this.dependencies.getClient()) {
      throw new Error('Cliente WhatsApp indisponível. Conecte-se antes de iniciar a campanha.')
    }

    const normalizedMessages = Array.isArray(messages) ? messages.filter(Boolean) : []
    if (normalizedMessages.length === 0) {
      throw new Error('Nenhuma mensagem válida foi enviada para iniciar a campanha.')
    }

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

    void this.runCampaign(runtime, config, normalizedMessages)
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
      return true
    }

    return updateCampaignStatus(campaignId, 'Pausado')
  }

  async resumeCampaign(campaignId: string): Promise<boolean> {
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

    return updateCampaignStatus(campaignId, 'Em andamento')
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

    this.dependencies.emitProgress({
      campaignId,
      sent: campaign.sent_count ?? 0,
      success: campaign.success_count ?? 0,
      failed: campaign.failed_count ?? 0,
      status: 'Falhou',
      finishedAt: new Date().toISOString(),
      log: `${nowTag()} ❌ Campanha finalizada como falha.`
    })

    return true
  }

  private async runCampaign(runtime: CampaignState, config: CampaignServiceConfig, messages: unknown[]): Promise<void> {
    let finalStatus: 'Concluído' | 'Falhou' | null = null
    let finalLog = ''

    try {
      await this.waitForScheduledStart(runtime, config)

      if (runtime.cancelled) {
        finalStatus = 'Falhou'
        finalLog = `${nowTag()} ❌ Campanha cancelada antes de iniciar.`
        return
      }

      updateCampaignStatus(runtime.campaignId, 'Em andamento')
      this.emit(runtime, {
        status: 'Em andamento',
        log: `${nowTag()} 🚀 Campanha iniciada.`
      })

      const pendingContacts = getPendingCampaignContacts(runtime.campaignId)
      if (pendingContacts.length === 0) {
        finalStatus = 'Concluído'
        finalLog = `${nowTag()} ✅ Nenhum contato pendente. Campanha concluída.`
        return
      }

      for (let index = 0; index < pendingContacts.length; index += 1) {
        const contact = pendingContacts[index]

        if (runtime.cancelled) {
          break
        }

        await this.waitIfPaused(runtime)

        if (runtime.cancelled) {
          break
        }

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

        if (runtime.cancelled) {
          break
        }

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

      if (runtime.cancelled) {
        finalStatus = 'Falhou'
        finalLog = `${nowTag()} ❌ Campanha cancelada.`
      } else {
        finalStatus = 'Concluído'
        finalLog = `${nowTag()} ✅ Campanha concluída com sucesso.`
      }
    } catch (error) {
      finalStatus = 'Falhou'
      finalLog = `${nowTag()} ❌ Erro fatal da campanha: ${safeMessage(error)}`
      console.error('[campaign] Erro fatal no loop da campanha:', error)
    } finally {
      runtime.running = false
      runtime.paused = false
      this.resolvePause(runtime)
      this.campaigns.delete(runtime.campaignId)

      if (finalStatus) {
        finishCampaign(runtime.campaignId, finalStatus, runtime.sent, runtime.success, runtime.failed)
        this.emit(runtime, {
          status: finalStatus,
          log: finalLog,
          finishedAt: new Date().toISOString()
        })
      }
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
        log: `${nowTag()} ❌ ${contact.name || 'Contato sem nome'} (${contact.number}): ${errorLog}`
      }
    }

    const normalizedNumber = this.normalizePhone(contact.number)
    if (!normalizedNumber) {
      const errorLog = 'Número inválido após limpeza de formato.'
      updateCampaignContactStatus(contact.id, 'failed', errorLog)
      return {
        status: 'failed',
        contactStatus: 'failed',
        errorLog,
        log: `${nowTag()} ❌ ${contact.name || 'Contato sem nome'} (${contact.number}): ${errorLog}`
      }
    }

    const formattedNumber = `${normalizedNumber}@c.us`

    try {
      // Proteção anti-ban: valida registro real do número no WhatsApp antes de enviar.
      const numberId = await client.getNumberId(formattedNumber)
      const targetId = numberId?._serialized ?? formattedNumber

      if (!numberId) {
        const errorLog = 'Número inválido no WhatsApp.'
        updateCampaignContactStatus(contact.id, 'failed', errorLog)
        return {
          status: 'failed',
          contactStatus: 'failed',
          errorLog,
          log: `${nowTag()} ❌ ${contact.name || 'Contato sem nome'} (${contact.number}): ${errorLog}`
        }
      }

      const randomMessage = messages[Math.floor(Math.random() * messages.length)]
      const parsedMessage = compileMessageForContact(randomMessage, contact.name)
      const finalMessage = parsedMessage || 'Olá, tudo bem?'

      if (config.simulateTyping) {
        // Comportamento humano: simula digitação proporcional ao tamanho da mensagem.
        const typingDelay = this.calculateTypingDelay(finalMessage)

        try {
          const chat = await client.getChatById(targetId)
          await chat.sendStateTyping()
          await this.delayWithControls(runtime, typingDelay)
        } catch (typingError) {
          console.warn('[campaign] Falha ao simular digitação:', typingError)
        }
      }

      await client.sendMessage(targetId, finalMessage, {
        linkPreview: config.waitLinkPreview ?? true,
        waitUntilMsgSent: true
      })

      updateCampaignContactStatus(contact.id, 'success', null)

      return {
        status: 'success',
        contactStatus: 'success',
        errorLog: null,
        log: `${nowTag()} ✅ Sucesso — ${contact.name || 'Contato sem nome'} (${contact.number})`
      }
    } catch (error) {
      const errorLog = safeMessage(error)
      updateCampaignContactStatus(contact.id, 'failed', errorLog)
      return {
        status: 'failed',
        contactStatus: 'failed',
        errorLog,
        log: `${nowTag()} ❌ Falha — ${contact.name || 'Contato sem nome'} (${contact.number}): ${errorLog}`
      }
    }
  }

  private emit(runtime: CampaignState, payload: Omit<CampaignProgressEvent, 'campaignId' | 'sent' | 'success' | 'failed'>): void {
    this.dependencies.emitProgress({
      campaignId: runtime.campaignId,
      sent: runtime.sent,
      success: runtime.success,
      failed: runtime.failed,
      ...payload
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
      if (runtime.cancelled) {
        return
      }

      await this.waitIfPaused(runtime)

      if (runtime.cancelled) {
        return
      }

      const step = Math.min(remainingMs, 500)
      await sleep(step)
      remainingMs -= step
    }
  }

  private async waitForScheduledStart(runtime: CampaignState, config: CampaignServiceConfig): Promise<void> {
    if (!config.scheduled || !config.scheduleDate) {
      return
    }

    const scheduleBase = new Date(config.scheduleDate)
    if (Number.isNaN(scheduleBase.getTime())) {
      return
    }

    const hour = Number(config.scheduleHour ?? '0')
    const minute = Number(config.scheduleMinute ?? '0')

    const scheduledTime = new Date(scheduleBase)
    scheduledTime.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0)

    const waitMs = scheduledTime.getTime() - Date.now()

    if (waitMs <= 0) {
      return
    }

    updateCampaignStatus(runtime.campaignId, 'Pausado')
    this.emit(runtime, {
      status: 'Pausado',
      log: `${nowTag()} ⏳ Campanha agendada para ${formatClock(scheduledTime)}.`
    })

    await this.delayWithControls(runtime, waitMs)
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

    if (!digits) {
      return null
    }

    const withCountryCode = digits.startsWith('55') ? digits : `55${digits}`

    if (withCountryCode.length < 12) {
      return null
    }

    return withCountryCode
  }

  private calculateTypingDelay(message: string): number {
    const baseDelay = Math.max(800, Math.min(15000, message.length * 50))
    return baseDelay
  }
}
