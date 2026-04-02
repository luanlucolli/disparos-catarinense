import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Rocket, Timer, ShieldCheck,
  UserRound, CalendarClock, Clock, CalendarIcon, Info,
} from "lucide-react";

interface StepDisparoProps {
  onBack: () => void;
  contactCount: number;
  onStartCampaign: (config: CampaignConfig) => void;
}

export interface CampaignConfig {
  contactCount: number;
  minDelay: number;
  maxDelay: number;
  cooldownEnabled: boolean;
  cooldownMinutes: number;
  cooldownEvery: number;
  simulateTyping: boolean;
  scheduled: boolean;
  scheduleDate?: Date;
  scheduleHour: string;
  scheduleMinute: string;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `~${Math.ceil(totalSeconds)} segundos`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);
  if (hours === 0) return `~${minutes} min`;
  return `~${hours}h ${minutes}min`;
}

function isSameCalendarDate(dateA: Date, dateB: Date): boolean {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

export default function StepDisparo({ onBack, contactCount, onStartCampaign }: StepDisparoProps) {
  const [minDelay, setMinDelay] = useState(15);
  const [maxDelay, setMaxDelay] = useState(30);
  const [cooldownEnabled, setCooldownEnabled] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState(5);
  const [cooldownEvery, setCooldownEvery] = useState(20);
  const [simulateTyping, setSimulateTyping] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleHour, setScheduleHour] = useState(() => String(new Date().getHours()).padStart(2, "0"));
  const [scheduleMinute, setScheduleMinute] = useState(() => String(new Date().getMinutes()).padStart(2, "0"));

  const total = Math.max(0, contactCount);

  const handleMinBlur = () => { if (minDelay > maxDelay) setMaxDelay(minDelay); };
  const handleMaxBlur = () => { if (maxDelay < minDelay) setMinDelay(maxDelay); };

  const now = new Date();
  const scheduleHourNumber = Number(scheduleHour);
  const isScheduleDateToday = Boolean(scheduleDate && isSameCalendarDate(scheduleDate, now));
  const minAllowedHour = isScheduleDateToday ? now.getHours() : 0;
  const minAllowedMinute =
    isScheduleDateToday && scheduleHourNumber === now.getHours() ? now.getMinutes() : 0;

  const handleScheduleDateChange = (date: Date | undefined) => {
    setScheduleDate(date);

    if (!date) {
      return;
    }

    const currentDate = new Date();
    if (!isSameCalendarDate(date, currentDate)) {
      return;
    }

    const currentHour = currentDate.getHours();
    const currentMinute = currentDate.getMinutes();
    const selectedHour = Number(scheduleHour);
    const selectedMinute = Number(scheduleMinute);

    if (selectedHour < currentHour) {
      setScheduleHour(String(currentHour).padStart(2, "0"));
      setScheduleMinute(String(currentMinute).padStart(2, "0"));
      return;
    }

    if (selectedHour === currentHour && selectedMinute < currentMinute) {
      setScheduleMinute(String(currentMinute).padStart(2, "0"));
    }
  };

  const handleScheduleHourChange = (rawHour: string) => {
    const parsedHour = Number(rawHour);
    const currentDate = new Date();
    const isToday = Boolean(scheduleDate && isSameCalendarDate(scheduleDate, currentDate));
    const minHour = isToday ? currentDate.getHours() : 0;
    const safeHour = Number.isFinite(parsedHour) ? parsedHour : minHour;
    const clampedHour = Math.min(23, Math.max(minHour, safeHour));

    setScheduleHour(String(clampedHour).padStart(2, "0"));

    if (isToday && clampedHour === currentDate.getHours()) {
      setScheduleMinute((previousMinute) => {
        const previousMinuteNumber = Number(previousMinute);
        const safeMinute = Number.isFinite(previousMinuteNumber)
          ? previousMinuteNumber
          : currentDate.getMinutes();
        const clampedMinute = Math.min(59, Math.max(currentDate.getMinutes(), safeMinute));
        return String(clampedMinute).padStart(2, "0");
      });
    }
  };

  const handleScheduleMinuteChange = (rawMinute: string) => {
    const parsedMinute = Number(rawMinute);
    const currentDate = new Date();
    const isToday = Boolean(scheduleDate && isSameCalendarDate(scheduleDate, currentDate));
    const selectedHour = Number(scheduleHour);
    const minMinute = isToday && selectedHour === currentDate.getHours() ? currentDate.getMinutes() : 0;
    const safeMinute = Number.isFinite(parsedMinute) ? parsedMinute : minMinute;
    const clampedMinute = Math.min(59, Math.max(minMinute, safeMinute));

    setScheduleMinute(String(clampedMinute).padStart(2, "0"));
  };

  // VERIFICAÇÃO EM TEMPO REAL DE DATA EXPIRADA
  const isPastSchedule = useMemo(() => {
    if (!scheduled || !scheduleDate) return false;
    const currentTime = new Date();
    const selectedTime = new Date(
      scheduleDate.getFullYear(),
      scheduleDate.getMonth(),
      scheduleDate.getDate(),
      Number(scheduleHour),
      Number(scheduleMinute),
      0
    );
    return selectedTime.getTime() <= currentTime.getTime();
  }, [scheduled, scheduleDate, scheduleHour, scheduleMinute]);

  const estimation = useMemo(() => {
    if (total <= 0) return null;
    const safeMin = Math.min(minDelay, maxDelay);
    const safeMax = Math.max(minDelay, maxDelay);
    const avgDelay = (safeMin + safeMax) / 2;
    let totalTime = total * avgDelay;
    if (cooldownEnabled && cooldownEvery > 0) {
      totalTime += Math.floor(total / cooldownEvery) * cooldownMinutes * 60;
    }
    const endDate = scheduled && scheduleDate && !isPastSchedule
      ? new Date(scheduleDate.getFullYear(), scheduleDate.getMonth(), scheduleDate.getDate(), Number(scheduleHour), Number(scheduleMinute), 0)
      : new Date();
    const finishDate = new Date(endDate.getTime() + totalTime * 1000);
    return { totalTime, finishDate };
  }, [total, minDelay, maxDelay, cooldownEnabled, cooldownMinutes, cooldownEvery, scheduled, scheduleDate, scheduleHour, scheduleMinute, isPastSchedule]);

  const confirmStart = () => {
    setConfirmOpen(false);
    onStartCampaign({
      contactCount: total,
      minDelay, maxDelay,
      cooldownEnabled, cooldownMinutes, cooldownEvery,
      simulateTyping,
      scheduled, scheduleDate, scheduleHour, scheduleMinute,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Configurar Disparo</h2>
        <p className="text-muted-foreground">Ajuste o ritmo e o comportamento do envio antes de iniciar.</p>
      </div>

      <Card className="border-0 shadow-card">
        <CardContent className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-base">Ritmo de Envio</h3>
            </div>
            <p className="text-sm text-muted-foreground -mt-2">Defina o tempo aleatório entre o envio de uma mensagem e outra.</p>
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Mínimo (segundos)</Label>
                <Input type="number" min={1} value={minDelay} onChange={(e) => setMinDelay(Math.max(1, Number(e.target.value)))} onBlur={handleMinBlur} className="h-11 text-center text-base" />
              </div>
              <span className="text-muted-foreground mt-5 font-medium">a</span>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Máximo (segundos)</Label>
                <Input type="number" min={1} value={maxDelay} onChange={(e) => setMaxDelay(Math.max(1, Number(e.target.value)))} onBlur={handleMaxBlur} className="h-11 text-center text-base" />
              </div>
            </div>
          </div>
          <div className="border-t border-border/50" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <div className="space-y-0.5">
                  <h3 className="font-semibold text-base">Pausa Estratégica Anti-bloqueio</h3>
                  <p className="text-xs text-muted-foreground">Faça pausas longas durante o envio para reduzir o risco de banimento.</p>
                </div>
              </div>
              <Switch checked={cooldownEnabled} onCheckedChange={setCooldownEnabled} />
            </div>
            {cooldownEnabled && (
              <div className="flex items-center gap-3 flex-wrap text-sm text-foreground bg-muted/50 rounded-lg p-4 animate-in fade-in slide-in-from-top-2">
                <span>Pausar o envio por</span>
                <Input type="number" min={1} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(Math.max(1, Number(e.target.value)))} className="h-9 w-20 text-center text-sm font-medium bg-background" />
                <span>minutos a cada</span>
                <Input type="number" min={1} value={cooldownEvery} onChange={(e) => setCooldownEvery(Math.max(1, Number(e.target.value)))} className="h-9 w-20 text-center text-sm font-medium bg-background" />
                <span>mensagens enviadas.</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-card">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <UserRound className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-base">Comportamento Humano</h3>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Simular tempo de digitação</p>
              <p className="text-xs text-muted-foreground">Mostra "digitando..." no WhatsApp do cliente proporcional ao tamanho do texto.</p>
            </div>
            <Switch checked={simulateTyping} onCheckedChange={setSimulateTyping} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-card">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" />
              <div className="space-y-0.5">
                <h3 className="font-semibold text-base">Programar Envio</h3>
                <p className="text-xs text-muted-foreground">Agende o início automático do disparo para uma data e horário específicos.</p>
              </div>
            </div>
            <Switch checked={scheduled} onCheckedChange={setScheduled} />
          </div>
          {scheduled && (
            <div className="flex flex-col items-start gap-2 mt-2 animate-in fade-in slide-in-from-top-2">
              <div className="flex flex-col sm:flex-row items-start gap-6 bg-muted/50 rounded-lg p-4 w-full">
                <div className="flex flex-col space-y-2">
                  <Label className="text-sm font-medium text-foreground">Data do Envio</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-[240px] justify-start text-left font-normal bg-background h-10", !scheduleDate && "text-muted-foreground", isPastSchedule && "border-destructive text-destructive")}>
                        <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                        {scheduleDate ? format(scheduleDate, "dd 'de' MMMM, yyyy", { locale: ptBR }) : "Selecionar data"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={scheduleDate} onSelect={handleScheduleDateChange} disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))} locale={ptBR} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label className="text-sm font-medium text-foreground">Horário de Início</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={minAllowedHour} max={23} value={scheduleHour} onChange={(e) => handleScheduleHourChange(e.target.value)} className={cn("h-10 w-16 text-center text-base bg-background font-medium", isPastSchedule && "border-destructive text-destructive")} />
                    <span className="text-lg font-bold text-muted-foreground pb-1">:</span>
                    <Input type="number" min={minAllowedMinute} max={59} value={scheduleMinute} onChange={(e) => handleScheduleMinuteChange(e.target.value)} className={cn("h-10 w-16 text-center text-base bg-background font-medium", isPastSchedule && "border-destructive text-destructive")} />
                  </div>
                </div>
              </div>
              {isPastSchedule && (
                <p className="text-xs text-destructive font-medium px-2">
                  O horário de agendamento precisa ser no futuro.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {estimation && total > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 mt-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-primary" />
            </div>
            <div className="space-y-1.5 flex-1">
              <h3 className="font-semibold text-base text-foreground">Resumo da Campanha</h3>
              <div className="flex flex-col sm:flex-row sm:items-center gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Total de Contatos:</span>
                  <span className="font-semibold text-foreground">{total}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Timer className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Duração Aprox.:</span>
                  <span className="font-semibold text-foreground">{formatDuration(estimation.totalTime)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Término Previsto:</span>
                  <span className="font-semibold text-foreground">{format(estimation.finishDate, "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">* Os tempos podem variar levemente devido ao intervalo aleatório de envio.</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-4">
        <Button variant="ghost" size="lg" className="text-base gap-2 py-6 text-muted-foreground hover:text-foreground" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Button>
        <Button size="lg" className="text-lg px-10 py-7 gap-2 shadow-lg hover:shadow-primary/20 transition-all duration-300" onClick={() => setConfirmOpen(true)} disabled={(scheduled && (!scheduleDate || isPastSchedule)) || total <= 0}>
          {scheduled ? (<><CalendarClock className="w-5 h-5" /> Agendar Disparo</>) : (<><Rocket className="w-5 h-5" /> Iniciar Disparos</>)}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {scheduled ? "Confirmar agendamento?" : "Iniciar disparos agora?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {scheduled
                ? `O envio de ${total} mensagens será agendado para ${scheduleDate ? format(scheduleDate, "dd/MM/yyyy", { locale: ptBR }) : ""} às ${scheduleHour}:${scheduleMinute}.`
                : `${total} mensagens serão enviadas imediatamente. Você poderá pausar ou cancelar pelo Histórico.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStart}>
              {scheduled ? "Confirmar Agendamento" : "Iniciar Agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}