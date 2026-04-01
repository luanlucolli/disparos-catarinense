import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import {
  RefreshCw,
  Pause,
  Play,
  XCircle,
  CheckCircle2,
  XOctagon,
  Clock,
  Clock3,
  CalendarClock,
  Users,
  ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type CampaignStatus =
  | "Concluído"
  | "Pausado"
  | "Falhou"
  | "Em andamento"
  | "Aguardando"
  | "Agendado";

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
  config?: unknown;
}

type CampaignDbRecord = Awaited<ReturnType<Window["api"]["getCampaigns"]>>[number];
type CampaignContactDbRecord = Awaited<ReturnType<Window["api"]["getCampaignContacts"]>>[number];
type CampaignProgressData = Parameters<Window["api"]["onCampaignProgress"]>[0] extends (
  arg: infer T
) => void
  ? T
  : never;

const defaultCampaigns: Campaign[] = [];
const OFFLINE_SCHEDULE_FAILURE_LOG =
  "[Sistema] Campanha cancelada: O aplicativo estava fechado no horário agendado.";

const parseSQLiteDate = (value: string | null | undefined): Date | null => {
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

const nowClock = (): string => formatTime(new Date());

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isScheduledConfig = (value: unknown): boolean => {
  if (!isObjectRecord(value)) return false;
  return Boolean(value.scheduled);
};

const normalizeStatus = (status?: string): CampaignStatus => {
  if (
    status === "Concluído" ||
    status === "Pausado" ||
    status === "Falhou" ||
    status === "Em andamento" ||
    status === "Aguardando" ||
    status === "Agendado"
  ) {
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
    config: campaign.config,
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
    case "Aguardando":
      return (
        <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-0 dark:text-amber-300 gap-1.5">
          <Clock3 className="h-3.5 w-3.5" /> Aguardando
        </Badge>
      );
    case "Agendado":
      return (
        <Badge className="bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 border-0 dark:text-sky-300 gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" /> Agendado
        </Badge>
      );
  }
}

interface Props {
  campaigns: Campaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<Campaign[]>>;
}

export default function HistoryView({ campaigns, setCampaigns }: Props) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<CampaignContactDbRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [campaignLogs, setCampaignLogs] = useState<Record<string, string[]>>({});

  const selectedIdRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const selected = campaigns.find((c) => c.id === selectedId) ?? null;
  const logs = selectedId ? campaignLogs[selectedId] ?? [] : [];

  // CORREÇÃO: Fallback Inteligente para Campanhas sem Logs na Memória
  const fallbackLog = (() => {
    if (logs.length > 0) return null;

    if (selected?.status === "Falhou") {
      if (isScheduledConfig(selected.config) && selected.sent === 0) {
        return OFFLINE_SCHEDULE_FAILURE_LOG;
      }
      return "[Sistema] Campanha interrompida: O aplicativo foi fechado durante a operação ou ocorreu um erro fatal.";
    }

    if (selected?.status === "Concluído") {
      return "[Sistema] Campanha finalizada. (Logs detalhados não estão disponíveis após o reinício do aplicativo).";
    }

    return null;
  })();

  const displayLogs = fallbackLog && logs.length === 0 ? [fallbackLog] : logs;

  const showLogPanel =
    !!selected &&
    (displayLogs.length > 0 ||
      selected.status === "Em andamento" ||
      selected.status === "Pausado" ||
      selected.status === "Aguardando" ||
      selected.status === "Agendado" ||
      selected.status === "Falhou");
      
  const canPauseResume = selected?.status === "Em andamento" || selected?.status === "Pausado";
  const canCancel =
    selected?.status === "Em andamento" ||
    selected?.status === "Pausado" ||
    selected?.status === "Aguardando" ||
    selected?.status === "Agendado";

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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

  useEffect(() => {
    const appendLog = (campaignId: string, line: string) => {
      setCampaignLogs((prev) => {
        const previousLogs = prev[campaignId] ?? [];
        return {
          ...prev,
          [campaignId]: [...previousLogs.slice(-199), line],
        };
      });
    };

    const unsubscribe = window.api.onCampaignProgress((event: CampaignProgressData) => {
      setCampaigns((prev) =>
        prev.map((campaign) => {
          if (campaign.id !== event.campaignId) {
            return campaign;
          }

          const nextStatus = event.status ? normalizeStatus(event.status) : campaign.status;

          let nextEndTime = campaign.endTime;
          if (nextStatus === "Concluído" || nextStatus === "Falhou") {
            const finishedDate = parseSQLiteDate(event.finishedAt) ?? new Date();
            nextEndTime = formatTime(finishedDate);
          } else if (
            nextStatus === "Em andamento" ||
            nextStatus === "Pausado" ||
            nextStatus === "Aguardando" ||
            nextStatus === "Agendado"
          ) {
            nextEndTime = undefined;
          }

          return {
            ...campaign,
            sent: event.sent,
            successCount: event.success,
            failedCount: event.failed,
            status: nextStatus,
            endTime: nextEndTime,
          };
        })
      );

      if (event.log) {
        appendLog(event.campaignId, event.log);
      }

      if (selectedIdRef.current === event.campaignId && event.contactId) {
        setSelectedContacts((prev) =>
          prev.map((contact) =>
            contact.id === event.contactId
              ? {
                  ...contact,
                  status: event.contactStatus ?? contact.status,
                  error_log: event.error ?? contact.error_log,
                }
              : contact
          )
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [setCampaigns]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLogs]);

  const openSheet = async (id: string) => {
    setSelectedId(id);
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

  const handlePauseResume = async () => {
    if (!selected) return;

    try {
      if (selected.status === "Em andamento") {
        await window.api.pauseCampaign(selected.id);
        setCampaigns((prev) =>
          prev.map((campaign) =>
            campaign.id === selected.id ? { ...campaign, status: "Pausado" } : campaign
          )
        );
      } else if (selected.status === "Pausado") {
        await window.api.resumeCampaign(selected.id);
        setCampaigns((prev) =>
          prev.map((campaign) =>
            campaign.id === selected.id ? { ...campaign, status: "Em andamento" } : campaign
          )
        );
      }
    } catch (error) {
      console.error("[history] Falha ao pausar/retomar campanha:", error);
      const message = error instanceof Error ? error.message : String(error);
      
      // CORREÇÃO: Feedback específico e amigável
      if (message.includes("Já existe uma campanha em execução")) {
        toast({
          title: "Fila Ocupada",
          description: "Não é possível retomar. Já existe outra campanha rodando.",
          variant: "destructive",
        });
        return;
      }

      if (message.includes("ainda não está pronto") || message.includes("indisponível")) {
         toast({
          title: "WhatsApp Desconectado",
          description: "Conecte seu WhatsApp antes de retomar a campanha.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Erro ao atualizar campanha",
        description: "Não foi possível pausar ou retomar a campanha.",
        variant: "destructive",
      });
    }
  };

  const confirmCancel = async () => {
    if (!selected) return;

    try {
      await window.api.cancelCampaign(selected.id);
      setCancelDialogOpen(false);
      setCampaigns((prev) =>
        prev.map((campaign) =>
          campaign.id === selected.id
            ? { ...campaign, status: "Falhou", endTime: nowClock() }
            : campaign
        )
      );
    } catch (error) {
      console.error("[history] Falha ao cancelar campanha:", error);
      toast({
        title: "Erro ao cancelar campanha",
        description: "Não foi possível cancelar a campanha no backend.",
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

              {!historyLoading && campaigns.map((campaign) => (
                <TableRow
                  key={campaign.id}
                  className="cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => openSheet(campaign.id)}
                >
                  <TableCell className="font-medium">{campaign.date}</TableCell>
                  <TableCell>{campaign.list}</TableCell>
                  <TableCell className="text-center">
                    {campaign.status === "Em andamento" || campaign.status === "Pausado" ? (
                      <div className="flex items-center gap-2 justify-center">
                        <Progress
                          value={campaign.total > 0 ? (campaign.sent / campaign.total) * 100 : 0}
                          className="h-2 w-20"
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          {campaign.sent}/{campaign.total}
                        </span>
                      </div>
                    ) : (
                      <span className="font-semibold">{campaign.sent}/{campaign.total}</span>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(campaign.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setSelectedContacts([]);
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
                    <SheetDescription className="text-xs mt-1">
                      {selected.date} — Início às {selected.startTime}
                    </SheetDescription>
                  </div>
                  {statusBadge(selected.status)}
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
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
                              {contact.error_log && (
                                <p className="text-destructive truncate">{contact.error_log}</p>
                              )}
                            </div>
                            <span className="text-muted-foreground shrink-0">{contact.status}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>

                {(selected.status === "Em andamento" ||
                  selected.status === "Pausado" ||
                  selected.status === "Aguardando" ||
                  selected.status === "Agendado") && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progresso</span>
                        <span className="font-semibold">{selected.sent}/{selected.total}</span>
                      </div>
                      <Progress
                        value={selected.total > 0 ? (selected.sent / selected.total) * 100 : 0}
                        className="h-3"
                      />
                    </div>

                    {(canPauseResume || canCancel) && (
                      <div className="flex gap-2">
                        {canPauseResume && (
                          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handlePauseResume}>
                            {selected.status === "Em andamento" ? (
                              <>
                                <Pause className="w-3.5 h-3.5" /> Pausar
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" /> Retomar
                              </>
                            )}
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className={canPauseResume ? "flex-1 gap-1.5" : "w-full gap-1.5"}
                            onClick={() => setCancelDialogOpen(true)}
                          >
                            <XCircle className="w-3.5 h-3.5" /> Cancelar
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {showLogPanel && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">Log em tempo real</h4>
                    <ScrollArea className="h-48 rounded-lg bg-[hsl(210,25%,10%)] p-3 font-mono text-xs text-[hsl(142,40%,70%)]">
                      {displayLogs.length === 0 && (
                        <p className="text-[hsl(210,15%,45%)] italic">Aguardando eventos...</p>
                      )}
                      {displayLogs.map((line, index) => (
                        <p
                          key={`${line}-${index}`}
                          className={
                            line.includes("❌") || line.includes("🛑")
                              ? "text-[hsl(0,72%,65%)]"
                              : line.includes("✅")
                                ? "text-[hsl(142,64%,55%)]"
                                : line.includes("⚠️") || line.includes("⏰") || line.includes("🕒")
                                  ? "text-amber-400"
                                  : "text-[hsl(210,15%,55%)]"
                          }
                        >
                          {line}
                        </p>
                      ))}
                      <div ref={logEndRef} />
                    </ScrollArea>
                  </div>
                )}

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

              <div className="border-t p-4">
                <Button variant="outline" className="w-full gap-2" disabled>
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