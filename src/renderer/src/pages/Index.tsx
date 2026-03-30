import { useEffect, useState, type ReactElement } from 'react'
import AppSidebar from '@/components/AppSidebar'
import CampaignWizard from '@/components/CampaignWizard'
import ConnectionView from '@/components/ConnectionView'
import HistoryView, { defaultCampaigns, type Campaign } from '@/components/HistoryView'
import QRCodeScreen from '@/components/QRCodeScreen'
import TemplatesView from '@/components/TemplatesView'
import type { CampaignConfig } from '@/components/steps/StepDisparo'
import type { JSONContent } from '@tiptap/core'

export type Template = { id: string; title: string; text: string; doc?: JSONContent }

type View = 'campaign' | 'templates' | 'history' | 'connection'
type UserInfo = { name?: string; number?: string }

const defaultTemplates: Template[] = []

export default function Index(): ReactElement {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [view, setView] = useState<View>('campaign')
  const [templates, setTemplates] = useState<Template[]>(defaultTemplates)
  const [campaigns, setCampaigns] = useState<Campaign[]>(defaultCampaigns)
  
  // Controle para não auto-iniciar após um logout explícito
  const [hasLoggedOut, setHasLoggedOut] = useState(false)

  // --- CORREÇÃO: Carregar os templates do Banco de Dados na inicialização ---
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const dbTemplates = await window.api.getTemplates()
        // Converte o formato do banco (string/JSON) para o formato do React
        const parsedTemplates = dbTemplates.map(t => ({
          id: t.id,
          title: t.title,
          text: t.text,
          doc: t.doc ? JSON.parse(t.doc as string) : undefined
        }))
        setTemplates(parsedTemplates)
      } catch (error) {
        console.error('Falha ao carregar templates do banco:', error)
      }
    }
    
    fetchTemplates()
  }, [])
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Esse listener é a ÚNICA fonte de verdade para deslogar a tela
    const unsubscribe = window.api.onWhatsAppEvent((_, data) => {
      if (data.type === 'disconnected') {
        setIsAuthenticated(false)
        setUserInfo(null)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const createPlaceholderContacts = (count: number): { name: string; number: string }[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `Contato ${index + 1}`,
      number: `550000000${String(index + 1).padStart(4, '0')}`
    }))

  const handleStartCampaign = (config: CampaignConfig): void => {
    const now = new Date()
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const newCampaign: Campaign = {
      id: `c-${Date.now()}`,
      date: dateStr,
      list: 'Nova Campanha',
      total: config.contactCount,
      sent: 0,
      successCount: 0,
      failedCount: 0,
      status: config.scheduled ? 'Pausado' : 'Em andamento',
      startTime: config.scheduled ? `${config.scheduleHour}:${config.scheduleMinute}` : timeStr
    }

    void (async () => {
      try {
        await window.api.createCampaign(
          {
            id: newCampaign.id,
            name: newCampaign.list,
            status: newCampaign.status,
            total_contacts: newCampaign.total,
            sent_count: newCampaign.sent,
            success_count: newCampaign.successCount,
            failed_count: newCampaign.failedCount
          },
          createPlaceholderContacts(newCampaign.total)
        )
      } catch (error) {
        console.error('[campaign] Falha ao criar campanha no banco local:', error)
      }

      setCampaigns((prev) => [newCampaign, ...prev])
      setView('history')
    })()
  }

  const handleConnect = (info: UserInfo): void => {
    setUserInfo(info)
    setIsAuthenticated(true)
    setHasLoggedOut(false) // Reseta ao conectar com sucesso
  }

  const handleDisconnect = (): void => {
    // 1. Avisa que o usuário QUER deslogar para não auto-iniciar o QR Code depois
    setHasLoggedOut(true) 
    
    // 2. Manda a ordem pro Backend fazer o trabalho sujo.
    // IMPORTANTE: Não mudamos setIsAuthenticated(false) aqui! 
    // Deixamos o backend avisar pelo listener lá no useEffect quando o logout terminar,
    // assim damos tempo do Modal de confirmação se fechar suavemente.
    window.api.desconectar()
  }

  if (!isAuthenticated) {
    return <QRCodeScreen onConnect={handleConnect} autoStart={!hasLoggedOut} />
  }

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar active={view} onChange={setView} />
      <main className="flex-1 p-8 lg:p-12 overflow-auto">
        {view === 'campaign' && (
          <CampaignWizard templates={templates} onStartCampaign={handleStartCampaign} />
        )}
        {view === 'templates' && (
          <TemplatesView templates={templates} setTemplates={setTemplates} />
        )}
        {view === 'history' && <HistoryView campaigns={campaigns} setCampaigns={setCampaigns} />}
        {view === 'connection' && (
          <ConnectionView
            userInfo={userInfo}
            onDisconnect={handleDisconnect}
          />
        )}
      </main>
    </div>
  )
}