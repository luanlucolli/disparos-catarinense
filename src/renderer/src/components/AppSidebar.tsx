import { MessageSquarePlus, FileText, History, Wifi, PanelLeftClose, PanelLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 256 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="h-screen bg-sidebar flex flex-col shrink-0 overflow-hidden"
    >
      <div className="p-3 flex justify-end">
        <button
          onClick={() => setCollapsed((current) => !current)}
          className="p-2 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors"
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      <nav className="flex-1 px-2 mt-2 space-y-1">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              title={collapsed ? item.label : undefined}
              className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-3" : ""
              } ${
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
              <item.icon className="w-5 h-5 relative z-10 shrink-0" />
              {!collapsed && <span className="relative z-10 whitespace-nowrap">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </motion.aside>
  );
}
