import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wifi } from "lucide-react";

export default function QRCodeScreen({ onConnect }: { onConnect: () => void }) {
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

          {/* Mock QR Code */}
          <div className="w-52 h-52 mx-auto bg-foreground/5 rounded-xl border-2 border-dashed border-border flex items-center justify-center">
            <div className="grid grid-cols-8 gap-0.5 w-40 h-40">
              {Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-full aspect-square rounded-[1px] ${
                    Math.random() > 0.45 ? "bg-foreground" : "bg-transparent"
                  }`}
                />
              ))}
            </div>
          </div>

          <Button size="lg" className="w-full text-base py-6" onClick={onConnect}>
            Simular Conexão
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
