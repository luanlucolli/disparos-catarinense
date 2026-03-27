import { MessageSquarePlus, FileText, History, Wifi } from "lucide-react";
import { motion } from "framer-motion";

type View = "campaign" | "templates" | "history" | "connection";

interface Props {
  active: View;
  onChange: (v: View) => void;
}

const items: { id: View; label: string; icon: typeof Wifi }[] = [
  { id: "campaign", label: "Nova Campanha", icon: MessageSquarePlus },
  { id: "templates", label: "Meus Modelos", icon: FileText },
  { id: "history", label: "Histórico", icon: History },
  { id: "connection", label: "Conexão", icon: Wifi },
];

export default function AppSidebar({ active, onChange }: Props) {
  return (
    <aside className="w-64 min-h-screen bg-sidebar flex flex-col shrink-0">
      <div className="p-6 pb-2" />

      <nav className="flex-1 px-3 mt-6 space-y-1">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "text-sidebar-active"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-foreground"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-sidebar-active/10 rounded-lg"
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
              <item.icon className="w-5 h-5 relative z-10" />
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
