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
import { useToast } from "@/hooks/use-toast";

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

type CampaignDbRecord = Awaited<ReturnType<Window["api"]["getCampaigns"]>>[number];
type CampaignContactDbRecord = Awaited<ReturnType<Window["api"]["getCampaignContacts"]>>[number];

const names = ["Maria", "João", "Ana", "Carlos", "Paula", "Roberto", "Fernanda", "Lucas", "Beatriz", "Diego"];
const phones = ["4799999-1111", "4798888-2222", "4797777-3333", "4796666-4444", "4795555-5555", "4794444-6666", "4793333-7777", "4792222-8888", "4791111-9999", "4790000-0000"];

const defaultCampaigns: Campaign[] = [];

const parseSQLiteDate = (value: string | null): Date | null => {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (date: Date | null): string => {
  if (!date) return "—";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
};

const formatTime = (date: Date | null): string => {
  if (!date) return "—";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const normalizeStatus = (status: string): CampaignStatus => {
  if (status === "Concluído" || status === "Pausado" || status === "Falhou" || status === "Em andamento") {
    return status;
  }
  return "Em andamento";
};

const mapDbCampaignToUi = (campaign: CampaignDbRecord): Campaign => {
  const createdAt = parseSQLiteDate(campaign.created_at);
  const finishedAt = parseSQLiteDate(campaign.finished_at);

  return {
    id: campaign.id,
    date: formatDate(createdAt),
    list: campaign.name || "Campanha sem nome",
    total: campaign.total_contacts ?? 0,
    sent: campaign.sent_count ?? 0,
    successCount: campaign.success_count ?? 0,
    failedCount: campaign.failed_count ?? 0,
    status: normalizeStatus(campaign.status),
    startTime: formatTime(createdAt),
    endTime: finishedAt ? formatTime(finishedAt) : undefined,
  };
};

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
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<CampaignContactDbRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const selected = campaigns.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    let isMounted = true;

    const loadCampaigns = async () => {
      setHistoryLoading(true);
      try {
        const campaignsFromDb = await window.api.getCampaigns();
        if (!isMounted) return;
        setCampaigns(campaignsFromDb.map(mapDbCampaignToUi));
      } catch (error) {
        console.error("[history] Falha ao carregar campanhas:", error);
        if (!isMounted) return;
        toast({
          title: "Erro ao carregar histórico",
          description: "Não foi possível buscar campanhas no banco local.",
          variant: "destructive",
        });
      } finally {
        if (isMounted) {
          setHistoryLoading(false);
        }
      }
    };

    void loadCampaigns();

    return () => {
      isMounted = false;
    };
  }, [setCampaigns, toast]);

  // Simulation tick for running campaigns
  const tick = useCallback(() => {
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.status !== "Em andamento") return c;
        if (c.sent >= c.total) {
          const finishedCampaign = { ...c, status: "Concluído" as const, endTime: now().slice(0, 5) };
          void window.api
            .finishCampaign(
              c.id,
              "Concluído",
              finishedCampaign.sent,
              finishedCampaign.successCount,
              finishedCampaign.failedCount
            )
            .catch((error) => {
              console.error("[history] Falha ao finalizar campanha:", error);
            });
          return finishedCampaign;
        }
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
    const selectedContact = selectedContacts[selected.sent] ?? null;
    const idx = selected.sent % names.length;
    const phone = selectedContact?.number || phones[idx];
    const name = selectedContact?.name || names[idx];
    const success = Math.random() > 0.1;
    const line = success
      ? `[${now()}] ✅ Sucesso — ${name} (${phone})`
      : `[${now()}] ❌ Falha: Número inválido (${phone})`;

    if (selected.status === "Em andamento") {
      setLogs((prev) => [...prev.slice(-80), `[${now()}] Enviando para ${phone}...`, line]);
    }
  }, [selected?.sent, selectedContacts]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Reset logs when opening a different campaign
  const openSheet = async (id: string) => {
    setSelectedId(id);
    setLogs([]);
    setContactsLoading(true);

    try {
      const contacts = await window.api.getCampaignContacts(id);
      setSelectedContacts(contacts);
    } catch (error) {
      console.error("[history] Falha ao carregar contatos da campanha:", error);
      setSelectedContacts([]);
      toast({
        title: "Erro ao carregar contatos",
        description: "Não foi possível buscar os contatos desta campanha.",
        variant: "destructive",
      });
    } finally {
      setContactsLoading(false);
    }
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

  const confirmCancel = async () => {
    if (!selected) return;

    try {
      const cancelledCampaign = { ...selected, status: "Falhou" as const, endTime: now().slice(0, 5) };
      await window.api.finishCampaign(
        selected.id,
        "Falhou",
        cancelledCampaign.sent,
        cancelledCampaign.successCount,
        cancelledCampaign.failedCount
      );

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === selected.id ? cancelledCampaign : c
        )
      );
      setCancelDialogOpen(false);
    } catch (error) {
      console.error("[history] Falha ao cancelar campanha:", error);
      toast({
        title: "Erro ao cancelar campanha",
        description: "Não foi possível atualizar o status no banco local.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full pb-10">
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
              {historyLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                    Carregando histórico...
                  </TableCell>
                </TableRow>
              )}

              {!historyLoading && campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                    Nenhuma campanha encontrada no banco local.
                  </TableCell>
                </TableRow>
              )}

              {!historyLoading && campaigns.map((c) => (
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
      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setSelectedContacts([]);
            setLogs([]);
          }
        }}
      >
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

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Contatos da campanha</h4>
                  {contactsLoading ? (
                    <p className="text-xs text-muted-foreground">Carregando contatos...</p>
                  ) : selectedContacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum contato registrado para esta campanha.</p>
                  ) : (
                    <ScrollArea className="h-36 rounded-lg border border-border p-3">
                      <div className="space-y-2">
                        {selectedContacts.map((contact) => (
                          <div key={contact.id} className="text-xs flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium truncate">{contact.name || "Sem nome"}</p>
                              <p className="text-muted-foreground truncate">{contact.number || "Sem número"}</p>
                            </div>
                            <span className="text-muted-foreground shrink-0">{contact.status}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
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
