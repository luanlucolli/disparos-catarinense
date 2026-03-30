import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import QRCode from 'react-qr-code'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Wifi } from 'lucide-react'

type StatusConexao =
  | 'idle'
  | 'carregando'
  | 'aguardando-qr'
  | 'autenticado'
  | 'conectado'
  | 'desconectado'

type UserInfo = {
  name?: string
  number?: string
}

interface QRCodeScreenProps {
  onConnect: (info: UserInfo) => void
  autoStart?: boolean // Nova prop para controlar o auto-start
}

const extractUserInfo = (payload: unknown): UserInfo => {
  if (typeof payload !== 'object' || payload === null) {
    return {}
  }

  const raw = payload as { name?: unknown; number?: unknown }

  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    number: typeof raw.number === 'string' ? raw.number : undefined
  }
}

export default function QRCodeScreen({ onConnect, autoStart = true }: QRCodeScreenProps): ReactElement {
  const [qrCodeData, setQrCodeData] = useState<string>('')
  // Inicializamos como idle, e só vamos para 'carregando' se iniciar a conexão
  const [statusConexao, setStatusConexao] = useState<StatusConexao>('idle')
  const [detalheStatus, setDetalheStatus] = useState<string>('')

  const connectedRef = useRef(false)
  const hasAutoStartedRef = useRef(false)

  const iniciarConexao = useCallback((): void => {
    connectedRef.current = false
    setStatusConexao('carregando')
    setDetalheStatus('')
    setQrCodeData('')
    window.api.iniciarConexao()
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.onWhatsAppEvent((_, data) => {
      if (data.type === 'qr') {
        setStatusConexao('aguardando-qr')
        setDetalheStatus('')
        setQrCodeData(typeof data.payload === 'string' ? data.payload : '')
        return
      }

      if (data.type === 'authenticated') {
        setStatusConexao('autenticado')
        setDetalheStatus('')
        return
      }

      if (data.type === 'ready') {
        setStatusConexao('conectado')
        setDetalheStatus('')

        if (!connectedRef.current) {
          connectedRef.current = true
          onConnect(extractUserInfo(data.payload))
        }

        return
      }

      if (data.type === 'disconnected') {
        connectedRef.current = false
        setStatusConexao('desconectado')
        setDetalheStatus(typeof data.payload === 'string' ? data.payload : '')
        setQrCodeData('')
      }
    })

    return () => {
      unsubscribe()
    }
  }, [iniciarConexao, onConnect])

  useEffect(() => {
    // Controlamos o auto-start com a prop e com a ref para evitar múltiplas chamadas
    if (autoStart && !hasAutoStartedRef.current && statusConexao === 'idle') {
      hasAutoStartedRef.current = true
      iniciarConexao()
    }
  }, [autoStart, iniciarConexao, statusConexao])

  const statusTexto = useMemo((): string => {
    if (statusConexao === 'carregando') return 'Carregando sessão do WhatsApp...'
    if (statusConexao === 'aguardando-qr') return 'QR Code gerado. Escaneie com seu WhatsApp.'
    if (statusConexao === 'autenticado') return 'Autenticado. Finalizando conexão...'
    if (statusConexao === 'conectado') return 'Conectado com sucesso.'
    if (statusConexao === 'desconectado') return detalheStatus || 'Desconectado. Inicie novamente.'
    return 'Aguardando início da conexão.'
  }, [detalheStatus, statusConexao])

  const isProcessando = ['carregando', 'aguardando-qr', 'autenticado'].includes(statusConexao)

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-0 shadow-card">
        <CardContent className="p-10 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto">
            <Wifi className="w-7 h-7 text-primary" />
          </div>

          <div>
            <h1 className="text-2xl font-bold mb-2">Conecte seu WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              Escaneie o QR Code para acessar o sistema.
            </p>
          </div>

          <div className="w-56 h-56 mx-auto bg-white rounded-xl border border-border flex items-center justify-center p-4">
            {statusConexao === 'carregando' ? (
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            ) : qrCodeData ? (
              <QRCode value={qrCodeData} size={192} className="h-full w-full" />
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                O QR Code aparecerá aqui.
              </p>
            )}
          </div>

          <p className="text-sm font-medium text-muted-foreground">{statusTexto}</p>

          <Button
            size="lg"
            className="w-full text-base py-6 transition-all"
            onClick={iniciarConexao}
            disabled={isProcessando}
          >
            {statusConexao === 'desconectado' || statusConexao === 'idle'
              ? 'Conectar WhatsApp'
              : 'Conectar WhatsApp'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}