import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RefreshCw, Pause, Play, XCircle, CheckCircle2, XOctagon, Clock,
  Users, ArrowRight,
} from "lucide-react";

export type CampaignStatus = "Concluído" | "Pausado" | "Falhou" | "Em andamento";

export interface Campaign {
  id: string;
  date: string;
  list: string;
  total: number;
  sent: number;
  successCount: number;
  failedCount: number;
  status: CampaignStatus;
  startTime: string;
  endTime?: string;
}

const names = ["Maria", "João", "Ana", "Carlos", "Paula", "Roberto", "Fernanda", "Lucas", "Beatriz", "Diego"];
const phones = ["4799999-1111", "4798888-2222", "4797777-3333", "4796666-4444", "4795555-5555", "4794444-6666", "4793333-7777", "4792222-8888", "4791111-9999", "4790000-0000"];

const defaultCampaigns: Campaign[] = [
  { id: "h1", date: "22/03/2026", list: "Clientes Março", total: 150, sent: 150, successCount: 142, failedCount: 8, status: "Concluído", startTime: "09:00", endTime: "10:45" },
  { id: "h2", date: "18/03/2026", list: "Promoção Páscoa", total: 89, sent: 89, successCount: 85, failedCount: 4, status: "Concluído", startTime: "14:30", endTime: "15:15" },
  { id: "h3", date: "15/03/2026", list: "Leads Instagram", total: 42, sent: 18, successCount: 16, failedCount: 2, status: "Pausado", startTime: "11:00" },
  { id: "h4", date: "10/03/2026", list: "Base Completa", total: 320, sent: 120, successCount: 100, failedCount: 20, status: "Falhou", startTime: "08:00", endTime: "08:52" },
  { id: "h5", date: "05/03/2026", list: "Novos Cadastros", total: 67, sent: 67, successCount: 64, failedCount: 3, status: "Concluído", startTime: "16:00", endTime: "16:40" },
];

function statusBadge(status: CampaignStatus) {
  switch (status) {
    case "Concluído":
      return <Badge className="bg-success/10 text-success hover:bg-success/20 border-0">✅ Concluído</Badge>;
    case "Pausado":
      return <Badge variant="secondary" className="border-0">⏸️ Pausado</Badge>;
    case "Falhou":
      return <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-0">❌ Falhou</Badge>;
    case "Em andamento":
      return <Badge className="bg-primary/10 text-primary hover:bg-primary/20 border-0 animate-pulse">🔄 Em andamento</Badge>;
  }
}

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

interface Props {
  campaigns: Campaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<Campaign[]>>;
}

export default function HistoryView({ campaigns, setCampaigns }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const selected = campaigns.find((c) => c.id === selectedId) ?? null;

  // Simulation tick for running campaigns
  const tick = useCallback(() => {
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.status !== "Em andamento") return c;
        if (c.sent >= c.total) return { ...c, status: "Concluído" as const, endTime: now().slice(0, 5) };
        const success = Math.random() > 0.08;
        return {
          ...c,
          sent: c.sent + 1,
          successCount: c.successCount + (success ? 1 : 0),
          failedCount: c.failedCount + (success ? 0 : 1),
        };
      })
    );
  }, [setCampaigns]);

  // Run simulation interval
  useEffect(() => {
    const hasRunning = campaigns.some((c) => c.status === "Em andamento");
    if (hasRunning) {
      intervalRef.current = setInterval(tick, 600);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
  }, [campaigns.some((c) => c.status === "Em andamento"), tick]);

  // Generate logs for selected running campaign
  useEffect(() => {
    if (!selected || (selected.status !== "Em andamento" && selected.status !== "Pausado")) return;
    const idx = selected.sent % names.length;
    const phone = phones[idx];
    const name = names[idx];
    const success = Math.random() > 0.1;
    const line = success
      ? `[${now()}] ✅ Sucesso — ${name} (${phone})`
      : `[${now()}] ❌ Falha: Número inválido (${phone})`;

    if (selected.status === "Em andamento") {
      setLogs((prev) => [...prev.slice(-80), `[${now()}] Enviando para ${phone}...`, line]);
    }
  }, [selected?.sent]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Reset logs when opening a different campaign
  const openSheet = (id: string) => {
    setSelectedId(id);
    setLogs([]);
  };

  const handlePauseResume = () => {
    if (!selected) return;
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === selected.id
          ? { ...c, status: c.status === "Em andamento" ? ("Pausado" as const) : ("Em andamento" as const) }
          : c
      )
    );
  };

  const confirmCancel = () => {
    if (!selected) return;
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === selected.id ? { ...c, status: "Falhou" as const, endTime: now().slice(0, 5) } : c
      )
    );
    setCancelDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Histórico de Campanhas</h2>
        <p className="text-muted-foreground">Clique em uma campanha para ver os detalhes.</p>
      </div>

      <Card className="border-0 shadow-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Data</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Nome da Lista</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-center">Progresso</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => openSheet(c.id)}
                >
                  <TableCell className="font-medium">{c.date}</TableCell>
                  <TableCell>{c.list}</TableCell>
                  <TableCell className="text-center">
                    {c.status === "Em andamento" ? (
                      <div className="flex items-center gap-2 justify-center">
                        <Progress value={(c.sent / c.total) * 100} className="h-2 w-20" />
                        <span className="text-xs font-medium text-muted-foreground">{c.sent}/{c.total}</span>
                      </div>
                    ) : (
                      <span className="font-semibold">{c.sent}/{c.total}</span>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
          {selected && (
            <>
              <SheetHeader className="p-6 pb-4 border-b">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <SheetTitle className="text-xl">{selected.list}</SheetTitle>
                    <SheetDescription className="text-xs mt-1">{selected.date} — Início às {selected.startTime}</SheetDescription>
                  </div>
                  {statusBadge(selected.status)}
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <SummaryCard icon={<Users className="w-4 h-4 text-primary" />} label="Total" value={selected.total} />
                  <SummaryCard icon={<CheckCircle2 className="w-4 h-4 text-success" />} label="Sucesso" value={selected.successCount} />
                  <SummaryCard icon={<XOctagon className="w-4 h-4 text-destructive" />} label="Falhas" value={selected.failedCount} />
                  <SummaryCard icon={<Clock className="w-4 h-4 text-muted-foreground" />} label="Término" value={selected.endTime ?? "—"} />
                </div>

                {/* Progress for active campaigns */}
                {(selected.status === "Em andamento" || selected.status === "Pausado") && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progresso</span>
                        <span className="font-semibold">{selected.sent}/{selected.total}</span>
                      </div>
                      <Progress value={(selected.sent / selected.total) * 100} className="h-3" />
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handlePauseResume}>
                        {selected.status === "Em andamento" ? <><Pause className="w-3.5 h-3.5" /> Pausar</> : <><Play className="w-3.5 h-3.5" /> Retomar</>}
                      </Button>
                      <Button variant="destructive" size="sm" className="flex-1 gap-1.5" onClick={() => setCancelDialogOpen(true)}>
                        <XCircle className="w-3.5 h-3.5" /> Cancelar
                      </Button>
                    </div>

                    {/* Live Log */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">Log em tempo real</h4>
                      <ScrollArea className="h-48 rounded-lg bg-[hsl(210,25%,10%)] p-3 font-mono text-xs text-[hsl(142,40%,70%)]">
                        {logs.length === 0 && (
                          <p className="text-[hsl(210,15%,45%)] italic">Aguardando eventos...</p>
                        )}
                        {logs.map((l, i) => (
                          <p key={i} className={l.includes("❌") ? "text-[hsl(0,72%,65%)]" : l.includes("✅") ? "text-[hsl(142,64%,55%)]" : "text-[hsl(210,15%,55%)]"}>
                            {l}
                          </p>
                        ))}
                        <div ref={logEndRef} />
                      </ScrollArea>
                    </div>
                  </>
                )}

                {/* Static summary for finished */}
                {selected.status === "Concluído" && (
                  <div className="bg-success/5 border border-success/20 rounded-lg p-4 text-center">
                    <p className="text-sm text-success font-medium">✅ Campanha finalizada com sucesso</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selected.successCount} enviados · {selected.failedCount} falhas · {selected.startTime} → {selected.endTime}
                    </p>
                  </div>
                )}

                {selected.status === "Falhou" && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-center">
                    <p className="text-sm text-destructive font-medium">❌ Campanha cancelada ou falhou</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selected.sent} de {selected.total} mensagens processadas antes da interrupção.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t p-4">
                <Button variant="outline" className="w-full gap-2">
                  <RefreshCw className="w-4 h-4" /> Repetir Campanha <ArrowRight className="w-4 h-4 ml-auto" />
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              O envio será interrompido imediatamente. As mensagens já enviadas não serão afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sim, cancelar campanha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export { defaultCampaigns };
