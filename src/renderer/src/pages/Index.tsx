import { useState } from "react";
import AppSidebar from "@/components/AppSidebar";
import ConnectionView from "@/components/ConnectionView";
import CampaignWizard from "@/components/CampaignWizard";
import QRCodeScreen from "@/components/QRCodeScreen";
import HistoryView, { defaultCampaigns, type Campaign } from "@/components/HistoryView";
import TemplatesView from "@/components/TemplatesView";
import type { JSONContent } from "@tiptap/core";
import type { CampaignConfig } from "@/components/steps/StepDisparo";

export type Template = { id: string; title: string; text: string; doc?: JSONContent };

const defaultTemplates: Template[] = [
  { id: "1", title: "Modelo de mensagem", text: "Isso é um modelo de mensagem." },
];

type View = "campaign" | "templates" | "history" | "connection";

export default function Index() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [view, setView] = useState<View>("campaign");
  const [templates, setTemplates] = useState<Template[]>(defaultTemplates);
  const [campaigns, setCampaigns] = useState<Campaign[]>(defaultCampaigns);

  const handleStartCampaign = (config: CampaignConfig) => {
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const newCampaign: Campaign = {
      id: `c-${Date.now()}`,
      date: dateStr,
      list: "Nova Campanha",
      total: config.contactCount,
      sent: 0,
      successCount: 0,
      failedCount: 0,
      status: config.scheduled ? "Pausado" : "Em andamento",
      startTime: config.scheduled ? `${config.scheduleHour}:${config.scheduleMinute}` : timeStr,
    };

    setCampaigns((prev) => [newCampaign, ...prev]);
    setView("history");
  };

  if (!isAuthenticated) {
    return <QRCodeScreen onConnect={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar active={view} onChange={setView} />
      <main className="flex-1 p-8 lg:p-12 overflow-auto">
        {view === "campaign" && <CampaignWizard templates={templates} onStartCampaign={handleStartCampaign} />}
        {view === "templates" && <TemplatesView templates={templates} setTemplates={setTemplates} />}
        {view === "history" && <HistoryView campaigns={campaigns} setCampaigns={setCampaigns} />}
        {view === "connection" && <ConnectionView onDisconnect={() => setIsAuthenticated(false)} />}
      </main>
    </div>
  );
}
