import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import StepContatos from "./steps/StepContatos";
import StepMensagem from "./steps/StepMensagem";
import StepDisparo from "./steps/StepDisparo";
import { Check } from "lucide-react";
import type { Template } from "@/pages/Index";
import type { CampaignConfig } from "./steps/StepDisparo";
import type { CampaignContactInput } from "./steps/StepContatos";
import type { JSONContent } from "@tiptap/core";

const steps = ["Contatos", "Mensagem", "Disparo"];

export type CampaignStartPayload = {
  config: CampaignConfig;
  contacts: CampaignContactInput[];
  messages: JSONContent[];
};

interface Props {
  templates: Template[];
  onStartCampaign: (payload: CampaignStartPayload) => void;
}

export default function CampaignWizard({ templates, onStartCampaign }: Props) {
  const [current, setCurrent] = useState(0);
  const [contacts, setContacts] = useState<CampaignContactInput[]>([]);
  const [messages, setMessages] = useState<JSONContent[]>([]);

  return (
    <div className="max-w-5xl mx-auto w-full pb-10">
      <div className="flex items-center justify-center mb-10">
        {steps.map((label, i) => (
          <div key={i} className="flex items-center">
            <button
              onClick={() => i < current && setCurrent(i)}
              className="flex items-center gap-2 cursor-default"
              style={{ cursor: i < current ? "pointer" : "default" }}
            >
              <div className={`stepper-dot ${i === current ? "stepper-dot-active" : i < current ? "stepper-dot-done" : "stepper-dot-pending"}`}>
                {i < current ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm font-medium hidden sm:inline ${i === current ? "text-foreground" : i < current ? "text-primary" : "text-muted-foreground"}`}>
                {label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div className={`stepper-line w-16 sm:w-24 ${i < current ? "bg-primary/30" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={current} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
          {current === 0 && (
            <StepContatos
              onNext={(nextContacts) => {
                setContacts(nextContacts);
                setCurrent(1);
              }}
            />
          )}
          {current === 1 && (
            <StepMensagem
              onNext={(nextMessages) => {
                setMessages(nextMessages);
                setCurrent(2);
              }}
              onBack={() => setCurrent(0)}
              templates={templates}
            />
          )}
          {current === 2 && (
            <StepDisparo
              onBack={() => setCurrent(1)}
              contactCount={contacts.length}
              onStartCampaign={(config) => onStartCampaign({ config, contacts, messages })}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
