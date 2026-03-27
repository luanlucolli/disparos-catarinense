import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (options: string[]) => void;
  initialOptions?: string[];
}

export default function SpintaxModal({ open, onClose, onSave, initialOptions }: Props) {
  const [options, setOptions] = useState<string[]>(["", ""]);

  useEffect(() => {
    if (open) {
      setOptions(initialOptions && initialOptions.length >= 2 ? [...initialOptions] : ["", ""]);
    }
  }, [open, initialOptions]);

  const addOption = () => setOptions((prev) => [...prev, ""]);

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateOption = (idx: number, val: string) => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? val : o)));
  };

  const handleSave = () => {
    const filled = options.filter((o) => o.trim());
    if (filled.length < 2) return;
    onSave(filled);
  };

  const handleClose = () => {
    setOptions(["", ""]);
    onClose();
  };

  const filledCount = options.filter((o) => o.trim()).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Variação de Palavras</DialogTitle>
          <DialogDescription>
            Adicione variações que serão escolhidas aleatoriamente em cada envio. Mínimo de 2 opções.
          </DialogDescription>
        </DialogHeader>

        {/* Ajuste de espaçamento: 
          1. Adicionado px-1 para não cortar o "ring" de foco do input.
          2. Adicionado pb-1 para o último item não colar no fundo.
        */}
        <div className="space-y-3 my-2 max-h-[45vh] overflow-y-auto px-1 py-1">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2 group">
              <span className="text-xs text-muted-foreground w-6 shrink-0 text-right">
                {i + 1}.
              </span>
              <Input
                placeholder={`Ex: ${i === 0 ? "Oi" : i === 1 ? "Olá" : "Bom dia"}`}
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                className="flex-1"
                autoFocus={i === 0 && !initialOptions?.length}
              />
              
              {/* Mantive o botão de remover fixo para evitar saltos de layout */}
              <div className="w-9 shrink-0">
                {options.length > 2 && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-9 w-9 text-muted-foreground hover:text-destructive" 
                    onClick={() => removeOption(i)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}

          <Button 
            variant="outline" 
            size="sm" 
            onClick={addOption} 
            className="gap-1.5 w-full border-dashed mt-2"
          >
            <Plus className="w-4 h-4" />
            Adicionar palavra
          </Button>
        </div>

        <DialogFooter className="mt-4 sm:justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={filledCount < 2}>
            {initialOptions?.length ? "Atualizar variações" : "Inserir no texto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}