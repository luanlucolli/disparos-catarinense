import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, UserPlus, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import SpintaxModal from "@/components/SpintaxModal";
import type { Template } from "@/pages/Index";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { JSONContent } from "@tiptap/core";
import { VariableNode, SpintaxNode, docToPlainText } from "@/lib/tiptap-extensions";

interface Props {
  templates: Template[];
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
}

export default function TemplatesView({ templates, setTemplates }: Props) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);
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
      Placeholder.configure({ placeholder: "Conteúdo da mensagem..." }),
      VariableNode,
      SpintaxNode.configure({ onOpenModal: openEditSpintaxModal }),
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class: "min-h-[160px] outline-none cursor-text text-sm leading-[2.0]",
      },
    },
  });

  const openNew = () => {
    setEditId(null);
    setEditTitle("");
    editor?.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }, { emitUpdate: false });
    setEditOpen(true);
    setTimeout(() => editor?.commands.focus(), 50);
  };

  const openEdit = (t: Template) => {
    setEditId(t.id);
    setEditTitle(t.title);
    if (t.doc) {
      editor?.commands.setContent(t.doc, { emitUpdate: false });
    } else {
      editor?.commands.setContent(`<p>${t.text.replace(/\n/g, "<br>")}</p>`, { emitUpdate: false });
    }
    setEditOpen(true);
    setTimeout(() => editor?.commands.focus("end"), 50);
  };

  const getEditorPlainText = (): string => {
    if (!editor) return "";
    return docToPlainText(editor.getJSON()).trim();
  };

  const handleSave = () => {
    if (!editTitle.trim()) return;
    const plainText = getEditorPlainText();
    if (!plainText) return;
    const doc = editor?.getJSON();

    if (editId) {
      setTemplates((prev) =>
        prev.map((t) => (t.id === editId ? { ...t, title: editTitle, text: plainText, doc } : t))
      );
      toast({ title: "Modelo atualizado" });
    } else {
      setTemplates((prev) => [
        ...prev,
        { id: crypto.randomUUID(), title: editTitle, text: plainText, doc },
      ]);
      toast({ title: "Modelo criado com sucesso" });
    }
    setEditOpen(false);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    setTemplates((prev) => prev.filter((t) => t.id !== deleteId));
    toast({ title: "Modelo excluído" });
    setDeleteId(null);
  };

  const insertVariable = () => {
    if (!editor) return;
    editor.chain().focus().insertContent([
      { type: "variable", attrs: { name: "nome_do_cliente" } },
      { type: "text", text: " " },
    ]).run();
  };

  const openNewSpintaxModal = () => {
    setEditingSpintaxPos(null);
    setEditingSpintaxOptions([]);
    setSpintaxOpen(true);
  };

  const handleSaveSpintax = useCallback(
    (options: string[]) => {
      if (!editor) return;
      const sanitized = options.map((o) => o.trim()).filter(Boolean);
      if (sanitized.length < 2) return;

      if (editingSpintaxPos !== null) {
        const node = editor.state.doc.nodeAt(editingSpintaxPos);
        if (node?.type.name === "spintax") {
          const tr = editor.state.tr.setNodeMarkup(editingSpintaxPos, undefined, {
            ...node.attrs, options: sanitized,
          });
          editor.view.dispatch(tr);
          editor.commands.focus();
        }
      } else {
        editor.chain().focus().insertContent([
          { type: "spintax", attrs: { options: sanitized } },
          { type: "text", text: " " },
        ]).run();
      }

      setSpintaxOpen(false);
      setEditingSpintaxPos(null);
      setEditingSpintaxOptions([]);
    },
    [editor, editingSpintaxPos]
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Meus Modelos de Mensagem</h2>
          <p className="text-muted-foreground">Gerencie seus modelos salvos para reutilizar em campanhas.</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" />
          Criar Novo Modelo
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card className="border-0 shadow-card">
          <CardContent className="p-12 text-center text-muted-foreground">
            Nenhum modelo salvo ainda. Crie seu primeiro modelo!
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <Card key={t.id} className="border-0 shadow-card">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold text-base">{t.title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                  {t.text}
                </p>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(t)}>
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleteId(t.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Modelo" : "Novo Modelo"}</DialogTitle>
            <DialogDescription>
              {editId ? "Atualize o título e o conteúdo do modelo." : "Defina um título e o conteúdo da mensagem."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-2">
            <Input
              placeholder="Título do modelo"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={insertVariable} className="gap-1.5">
                <UserPlus className="w-4 h-4" /> Nome do Cliente
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={openNewSpintaxModal}>
                <Sparkles className="w-4 h-4" /> Palavras Alternativas
              </Button>
            </div>

            <div
              className="relative rounded-lg border border-input bg-background px-4 py-3 transition-all focus-within:ring-1 focus-within:ring-primary/20"
              onClick={() => editor?.commands.focus()}
            >
              <EditorContent editor={editor} />
            </div>

            <p className="text-xs text-muted-foreground">
              Use os botões acima para inserir variáveis dinâmicas e palavras alternativas.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!editTitle.trim()}>
              {editId ? "Salvar Alterações" : "Criar Modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. O modelo será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
