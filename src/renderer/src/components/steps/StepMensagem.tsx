import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  Sparkles,
  ArrowLeft,
  MessageCircle,
  Plus,
  RefreshCw,
  LogOut,
  AlertTriangle,
  X,
  FolderOpen,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import SpintaxModal from "@/components/SpintaxModal";
import type { Template } from "@/pages/Index";
import { cn } from "@/lib/utils";

// Tiptap Imports
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { JSONContent } from "@tiptap/core";
import { VariableNode, SpintaxNode, generatePreviewText } from "@/lib/tiptap-extensions";

const MAX_TABS = 5;
const tabLabels = ["A", "B", "C", "D", "E"];
const OPT_OUT_TEXT = "(Para parar de receber nossas mensagens, é só responder SAIR)";
const INLINE_TAG_WIDTH = "w-[220px] max-w-[220px]";

const createEmptyDoc = (): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
interface Props {
  onNext: () => void;
  onBack: () => void;
  templates: Template[];
}

export default function StepMensagem({ onNext, onBack, templates }: Props) {
  const { toast } = useToast();

  const [tabsDocs, setTabsDocs] = useState<JSONContent[]>([createEmptyDoc()]);
  const [activeTab, setActiveTab] = useState(0);
  const [previewVariant, setPreviewVariant] = useState(0);
  const activeTabRef = useRef(activeTab);
  const loadedTabRef = useRef<number | null>(null);

  const [spintaxOpen, setSpintaxOpen] = useState(false);
  const [editingSpintaxPos, setEditingSpintaxPos] = useState<number | null>(null);
  const [editingSpintaxOptions, setEditingSpintaxOptions] = useState<string[]>([]);

  const openEditSpintaxModal = useCallback((pos: number, options: string[]) => {
    setEditingSpintaxPos(pos);
    setEditingSpintaxOptions(options);
    setSpintaxOpen(true);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Digite sua mensagem aqui...",
      }),
      VariableNode,
      SpintaxNode.configure({
        onOpenModal: openEditSpintaxModal,
      }),
    ],
    content: tabsDocs[0],
    editorProps: {
  attributes: {
    // Altere de leading-[1.8] para leading-[2.0] ou leading-loose
    class: "min-h-[220px] outline-none cursor-text text-sm leading-[2.0]",
  },
      handleDOMEvents: {
        paste: (view) => {
          requestAnimationFrame(() => {
            view.focus();
          });
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      setTabsDocs((prev) => {
        const newDocs = [...prev];
        newDocs[activeTabRef.current] = editor.getJSON();
        return newDocs;
      });
    },
  });

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!editor) return;
    if (loadedTabRef.current === activeTab) return;

    editor.commands.setContent(tabsDocs[activeTab] || createEmptyDoc(), {
      emitUpdate: false,
    });

    loadedTabRef.current = activeTab;
    editor.commands.focus("end");
  }, [activeTab, editor]);

  const addTab = () => {
    if (tabsDocs.length >= MAX_TABS) return;

    setTabsDocs((prev) => [...prev, createEmptyDoc()]);
    setActiveTab(tabsDocs.length);
    setPreviewVariant(0);
  };

  const removeTab = (idx: number) => {
    if (tabsDocs.length <= 1) return;

    setTabsDocs((prev) => prev.filter((_, i) => i !== idx));

    setActiveTab((prev) => {
      if (prev === idx) {
        const nextTab = idx > 0 ? idx - 1 : 0;
        loadedTabRef.current = null;
        return nextTab;
      }

      if (prev > idx) {
        loadedTabRef.current = null;
        return prev - 1;
      }

      return prev;
    });

    setPreviewVariant(0);
  };

  const insertVariable = () => {
    if (!editor) return;

    editor
      .chain()
      .focus()
      .insertContent([
        { type: "variable", attrs: { name: "nome_do_cliente" } },
        { type: "text", text: " " },
      ])
      .run();
  };

  const openNewSpintaxModal = () => {
    setEditingSpintaxPos(null);
    setEditingSpintaxOptions([]);
    setSpintaxOpen(true);
  };

  const handleSaveSpintax = useCallback(
    (options: string[]) => {
      if (!editor) return;

      const sanitizedOptions = options.map((item) => item.trim()).filter(Boolean);

      if (sanitizedOptions.length < 2) {
        toast({
          title: "Spintax inválido",
          description: "Informe pelo menos 2 opções válidas.",
          variant: "destructive",
        });
        return;
      }

      if (editingSpintaxPos !== null) {
        const node = editor.state.doc.nodeAt(editingSpintaxPos);

        if (node?.type.name === "spintax") {
          const tr = editor.state.tr.setNodeMarkup(editingSpintaxPos, undefined, {
            ...node.attrs,
            options: sanitizedOptions,
          });

          editor.view.dispatch(tr);
          editor.commands.focus();
        }
      } else {
        editor
          .chain()
          .focus()
          .insertContent([
            { type: "spintax", attrs: { options: sanitizedOptions } },
            { type: "text", text: " " },
          ])
          .run();
      }

      setSpintaxOpen(false);
      setEditingSpintaxPos(null);
      setEditingSpintaxOptions([]);
    },
    [editor, editingSpintaxPos, toast]
  );

  const insertOptOut = () => {
    if (!editor) return;
    editor.chain().focus().insertContent(`\n\n${OPT_OUT_TEXT}`).run();
  };

  const loadTemplate = (template: Template) => {
    if (!editor) return;

    if (template.doc) {
      editor.commands.setContent(template.doc, { emitUpdate: true });
    } else {
      const newContent = `<p>${template.text.replace(/\n/g, "<br>")}</p>`;
      editor.commands.setContent(newContent, { emitUpdate: true });
    }
    editor.commands.focus("end");

    toast({
      title: "Modelo carregado com sucesso",
      description: `"${template.title}" foi aplicado.`,
    });
  };

  const previewText = useMemo(() => {
    const targetDoc = tabsDocs[previewVariant] || tabsDocs[activeTab];
    return generatePreviewText(targetDoc).trim() || "Sua mensagem aparecerá aqui...";
  }, [tabsDocs, previewVariant, activeTab]);

  const cyclePreview = () => {
    if (tabsDocs.length <= 1) return;
    setPreviewVariant((prev) => (prev + 1) % tabsDocs.length);
  };

  const hasAnyContent = useMemo(() => {
    return tabsDocs.some((doc) => generatePreviewText(doc).trim().length > 0);
  }, [tabsDocs]);

  const hasLink = useMemo(() => {
    const allText = tabsDocs.map((doc) => generatePreviewText(doc)).join(" ");
    return /https?:\/\//.test(allText);
  }, [tabsDocs]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Escrever Mensagem</h2>
        <p className="text-muted-foreground">
          Personalize a mensagem que será enviada para cada contato.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="border-0 shadow-card lg:col-span-3">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Escreva versões diferentes da mesma mensagem. O sistema irá revezar entre elas.
              </p>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                    <FolderOpen className="w-4 h-4" /> Carregar Modelo
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-56">
                  {templates.length === 0 && (
                    <DropdownMenuItem disabled>Nenhum modelo salvo</DropdownMenuItem>
                  )}

                  {templates.map((t) => (
                    <DropdownMenuItem key={t.id} onClick={() => loadTemplate(t)}>
                      {t.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {tabsDocs.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    loadedTabRef.current = null;
                    setActiveTab(i);
                  }}
                  className={`group flex items-center gap-1 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    i === activeTab
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  Mensagem {tabLabels[i]}
                  {tabsDocs.length > 1 && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTab(i);
                      }}
                      className={`ml-0.5 rounded-full p-0.5 transition-colors ${
                        i === activeTab
                          ? "hover:bg-primary-foreground/20"
                          : "hover:bg-foreground/10"
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </span>
                  )}
                </button>
              ))}

              {tabsDocs.length < MAX_TABS && (
                <button
                  onClick={addTab}
                  className="px-3 py-1.5 rounded-full text-sm font-medium text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar Versão
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={insertVariable} className="gap-1.5">
                <UserPlus className="w-4 h-4" /> Nome do Cliente
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={openNewSpintaxModal}
              >
                <Sparkles className="w-4 h-4" /> Palavras Alternativas
              </Button>

              <Button variant="outline" size="sm" className="gap-1.5" onClick={insertOptOut}>
                <LogOut className="w-4 h-4" /> Opção de Saída
              </Button>
            </div>

            <div
              className="relative rounded-lg border border-input bg-background px-4 py-3 transition-all focus-within:ring-1 focus-within:ring-primary/20"
              onClick={() => editor?.commands.focus()}
            >
              <EditorContent editor={editor} />
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Escreva direto no campo. <strong>Clique</strong> num bloco de palavra
              alternativa para editar as opções.
            </p>

            {hasLink && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900 mt-4">
                <AlertTriangle className="h-4 w-4 !text-amber-600" />
                <AlertDescription className="text-sm leading-relaxed">
                  <strong>Dica de Ouro:</strong> Evite enviar links na primeira mensagem. Isso
                  aumenta a chance de bloqueio.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-card lg:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Pré-visualização</span>
                {tabsDocs.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    (Mensagem {tabLabels[previewVariant]})
                  </span>
                )}
              </div>

              {tabsDocs.length > 1 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={cyclePreview}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Testar Variações</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            <div className="bg-muted/50 rounded-xl p-4 min-h-[200px]">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                  J
                </div>
                <div>
                  <p className="text-sm font-medium">João</p>
                  <p className="text-xs text-muted-foreground">+55 47 9999-1111</p>
                </div>
              </div>

              <div className="whatsapp-bubble bg-[#E7FFDB] text-[#111B21] p-2 rounded-lg rounded-tr-none shadow-sm relative w-max max-w-[90%] ml-auto">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{previewText}</p>
                <p className="text-[10px] text-muted-foreground text-right mt-1">14:32 ✓✓</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" size="lg" className="text-base gap-2 py-6" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Button>

        <Button
          size="lg"
          className="text-base px-8 py-6"
          onClick={onNext}
          disabled={!hasAnyContent}
        >
          Próximo Passo →
        </Button>
      </div>

      <SpintaxModal
        open={spintaxOpen}
        onClose={() => {
          setSpintaxOpen(false);
          setEditingSpintaxPos(null);
          setEditingSpintaxOptions([]);
          editor?.commands.focus();
        }}
        onSave={handleSaveSpintax}
        initialOptions={editingSpintaxOptions}
      />
    </div>
  );
}