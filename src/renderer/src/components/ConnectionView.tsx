import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, LogOut, Phone, User } from "lucide-react";

type UserInfo = { name?: string; number?: string };

interface ConnectionViewProps {
  onDisconnect: () => void;
  userInfo?: UserInfo | null;
}

export default function ConnectionView({ onDisconnect, userInfo }: ConnectionViewProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="max-w-5xl mx-auto w-full pb-10">
        <div className="flex flex-col items-center justify-center min-h-[70vh] p-4">
          <Card className="w-full max-w-md shadow-xl border-0 overflow-hidden relative bg-card">
            {/* Banner de fundo estilizado (Vibe WhatsApp) */}
            <div className="h-32 bg-gradient-to-r from-emerald-500 to-green-400 absolute top-0 left-0 w-full opacity-90"></div>

            <CardContent className="p-8 pt-20 text-center space-y-6 relative z-10">
              {/* Ícone de Sucesso flutuando sobre o banner */}
              <div className="w-20 h-20 rounded-full bg-background border-4 border-background flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>

              {/* Cabeçalho de Status */}
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  WhatsApp Conectado
                </h2>

                <div className="flex items-center justify-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 rounded-full w-max mx-auto border border-emerald-200 dark:border-emerald-500/20">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  Sessão Ativa
                </div>
              </div>

              {/* Box de Informações do Usuário */}
              <div className="bg-muted/40 rounded-xl p-4 space-y-4 border border-border/50 text-left mt-2">
                <div className="flex items-center gap-3">
                  <div className="bg-background p-2.5 rounded-lg shadow-sm border border-border/50">
                    <User className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                      Nome do Perfil
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {userInfo?.name || "Não informado"}
                    </p>
                  </div>
                </div>

                <div className="h-px w-full bg-border/50"></div>

                <div className="flex items-center gap-3">
                  <div className="bg-background p-2.5 rounded-lg shadow-sm border border-border/50">
                    <Phone className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                      Número Vinculado
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {userInfo?.number ? `+${userInfo.number}` : "Carregando..."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Botão de Ação */}
              <Button
                variant="outline"
                size="lg"
                className="w-full text-base py-6 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-all"
                onClick={() => setConfirmOpen(true)}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Desconectar Aparelho
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Você sairá desta sessão e precisará escanear um novo QR Code pelo seu celular para reconectar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
