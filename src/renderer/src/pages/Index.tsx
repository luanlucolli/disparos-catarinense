import { useEffect, useState, type ReactElement } from 'react'
import AppSidebar from '@/components/AppSidebar'
import CampaignWizard, { type CampaignStartPayload } from '@/components/CampaignWizard'
import ConnectionView from '@/components/ConnectionView'
import HistoryView, { defaultCampaigns, type Campaign } from '@/components/HistoryView'
import QRCodeScreen from '@/components/QRCodeScreen'
import TemplatesView from '@/components/TemplatesView'
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
  
  const [hasLoggedOut, setHasLoggedOut] = useState(false)

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const dbTemplates = await window.api.getTemplates()
        const parsedTemplates = dbTemplates.map(t => ({
          id: t.id,
          title: t.title,
          text: t.text,
          doc:
            typeof t.doc === 'string'
              ? (JSON.parse(t.doc) as JSONContent)
              : (t.doc as JSONContent | undefined)
        }))
        setTemplates(parsedTemplates)
      } catch (error) {
        console.error('Falha ao carregar templates do banco:', error)
      }
    }
    
    fetchTemplates()
  }, [])

  useEffect(() => {
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

  const handleStartCampaign = ({ config, contacts, messages }: CampaignStartPayload): void => {
    if (contacts.length === 0 || messages.length === 0) {
      return
    }

    const now = new Date()
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const newCampaign: Campaign = {
      id: `c-${Date.now()}`,
      date: dateStr,
      list: 'Nova Campanha',
      total: contacts.length,
      sent: 0,
      successCount: 0,
      failedCount: 0,
      status: config.scheduled ? 'Agendado' : 'Aguardando',
      startTime: config.scheduled ? `${config.scheduleHour}:${config.scheduleMinute}` : timeStr,
      config
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
            failed_count: newCampaign.failedCount,
            config,
            messages
          },
          contacts
        )

        setCampaigns((prev) => [newCampaign, ...prev.filter((campaign) => campaign.id !== newCampaign.id)])
        setView('history')

        await window.api.enqueueCampaign(newCampaign.id, config, messages)
      } catch (error) {
        console.error('[campaign] Falha ao iniciar campanha:', error)
        setCampaigns((prev) =>
          prev.map((campaign) =>
            campaign.id === newCampaign.id
              ? { ...campaign, status: 'Falhou', endTime: timeStr }
              : campaign
          )
        )
      }
    })()
  }

  const handleConnect = (info: UserInfo): void => {
    setUserInfo(info)
    setIsAuthenticated(true)
    setHasLoggedOut(false)
  }

  const handleDisconnect = (): void => {
    setHasLoggedOut(true) 
    window.api.desconectar()
  }

  if (!isAuthenticated) {
    return <QRCodeScreen onConnect={handleConnect} autoStart={!hasLoggedOut} />
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar active={view} onChange={setView} />
      <main className="flex-1 p-6 md:p-8 lg:p-12 overflow-y-auto relative">
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
