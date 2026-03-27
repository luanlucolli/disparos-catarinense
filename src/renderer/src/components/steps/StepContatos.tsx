import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, CheckCircle2, FileSpreadsheet } from "lucide-react";

export default function StepContatos({ onNext }: { onNext: (count: number) => void }) {
  const [hasContacts, setHasContacts] = useState(false);
  const [pastedText, setPastedText] = useState("");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHasContacts(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Adicionar Contatos</h2>
        <p className="text-muted-foreground">Importe sua lista de clientes para iniciar a campanha.</p>
      </div>

      <Card className="border-0 shadow-card">
        <CardContent className="p-6 space-y-6">
          {/* Drop zone */}
          <div
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => setHasContacts(true)}
          >
            <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center mx-auto mb-4">
              <Upload className="w-6 h-6 text-primary" />
            </div>
            <p className="text-base font-medium mb-1">Arraste sua planilha do Excel aqui</p>
            <p className="text-sm text-muted-foreground">ou clique para selecionar</p>
            <div className="flex items-center justify-center gap-2 mt-3 text-xs text-muted-foreground">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Aceita arquivos .xlsx e .xls</span>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">OU</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Paste area */}
          <div>
            <label className="text-sm font-medium mb-2 block">Cole os números e nomes aqui</label>
            <Textarea
              placeholder={"João, 47999991111\nMaria, 47999992222\nAna, 47999993333"}
              rows={4}
              className="text-base resize-none"
              value={pastedText}
              onChange={(e) => {
                setPastedText(e.target.value);
                if (e.target.value.length > 10) setHasContacts(true);
              }}
            />
          </div>

          {/* Success alert */}
          {hasContacts && (
            <div className="flex items-center gap-3 bg-success/10 text-success rounded-lg px-4 py-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Encontramos 150 contatos válidos</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" className="text-base px-8 py-6" disabled={!hasContacts} onClick={() => onNext(150)}>
          Próximo Passo →
        </Button>
      </div>
    </div>
  );
}
