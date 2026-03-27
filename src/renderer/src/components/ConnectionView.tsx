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
import { CheckCircle2 } from "lucide-react";

export default function ConnectionView({ onDisconnect }: { onDisconnect: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-center min-h-[70vh]">
        <Card className="w-full max-w-md shadow-card border-0">
          <CardContent className="p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>

            <div>
              <h2 className="text-xl font-bold mb-1">WhatsApp Conectado</h2>
              <p className="text-base text-success font-medium mb-1">🟢 Status: Conectado</p>
              <p className="text-sm text-muted-foreground">Número: +55 47 9999-9999</p>
            </div>

            <Button
              variant="outline"
              size="lg"
              className="w-full text-base py-6 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              Desconectar
            </Button>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Você sairá desta sessão e precisará escanear o QR Code novamente para reconectar.
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
