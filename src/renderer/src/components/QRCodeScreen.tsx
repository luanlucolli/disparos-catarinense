import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import QRCode from 'react-qr-code'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
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
  autoStart?: boolean
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
  const [statusConexao, setStatusConexao] = useState<StatusConexao>('idle')
  const [detalheStatus, setDetalheStatus] = useState<string>('')
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  
  // NOVO: Estado que controla se houve um erro real (timeout/falha)
  const [hasConnectionError, setHasConnectionError] = useState(false)

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
        setHasConnectionError(false) // Oculta botão se chegar no QR Code normal
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
        setHasConnectionError(false) // Limpa erros anteriores
        if (!connectedRef.current) {
          connectedRef.current = true
          onConnect(extractUserInfo(data.payload))
        }
        return
      }

      if (data.type === 'disconnected') {
        connectedRef.current = false
        setStatusConexao('desconectado')
        const msg = typeof data.payload === 'string' ? data.payload : ''
        setDetalheStatus(msg)
        setQrCodeData('')

        // LÓGICA INTELIGENTE: Só exibe o Botão de Emergência se for um erro.
        // Se a vendedora apenas fez um logout ou limpou a sessão com sucesso, o botão fica escondido.
        const isErrorMsg = msg.toLowerCase().includes('falha') || 
                           msg.toLowerCase().includes('tempo limite') || 
                           msg.toLowerCase().includes('erro')
        setHasConnectionError(isErrorMsg)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [iniciarConexao, onConnect])

  useEffect(() => {
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
  
  // ATUALIZADO: Só mostra se a conexão está parada E houve um erro
  const podeExibirSaidaEmergencia = statusConexao === 'desconectado' && hasConnectionError

  const confirmarForcarReset = useCallback((): void => {
    setResetDialogOpen(false)
    window.api.forcarReset()
  }, [])

  return (
    <div className="max-w-5xl mx-auto w-full pb-10">
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-4">
        <Card className="w-full max-w-md shadow-xl border-0 overflow-hidden relative bg-card">
          <div className="h-32 bg-gradient-to-r from-primary to-primary/70 absolute top-0 left-0 w-full opacity-90"></div>

          <CardContent className="p-8 pt-20 text-center space-y-6 relative z-10">
            <div className="w-20 h-20 rounded-full bg-background border-4 border-background flex items-center justify-center mx-auto shadow-md">
              <Wifi className="w-10 h-10 text-primary" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Conecte seu WhatsApp</h1>
              <p className="text-sm text-muted-foreground">
                Escaneie o QR Code para acessar o sistema.
              </p>
            </div>

            <div className="w-56 h-56 mx-auto bg-white rounded-xl border border-border flex items-center justify-center p-4 shadow-sm">
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

            <p className="text-sm font-medium text-muted-foreground bg-muted/40 py-2 px-3 rounded-lg border border-border/50">
              {statusTexto}
            </p>

            <div className="space-y-3">
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

              {/* Botão Salva-vidas Oculto por padrão */}
              {podeExibirSaidaEmergencia && (
                <Button
                  variant="ghost"
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setResetDialogOpen(true)}
                >
                  Problemas na conexão? Clique aqui para limpar a sessão
                </Button>
              )}
            </div>

            <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Limpar sessão do WhatsApp?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso irá remover sua conexão atual e fechar o WhatsApp para limpeza. Deseja continuar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={confirmarForcarReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Sim, limpar sessão
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}