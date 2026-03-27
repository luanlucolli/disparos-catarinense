import { Node, mergeAttributes, nodeInputRule, nodePasteRule } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const stopEditorEvent = (e: React.MouseEvent | MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

export const VariableNode = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: "nome_do_cliente",
        parseHTML: (element) => element.getAttribute("data-name") || "nome_do_cliente",
        renderHTML: (attributes) => ({ "data-name": attributes.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="variable"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "variable" }),
      `{{${node.attrs.name || "nome_do_cliente"}}}`,
    ];
  },

  renderText({ node }) {
    return `{{${node.attrs.name || "nome_do_cliente"}}}`;
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: /\{\{([^}]+)\}\}/g,
        type: this.type,
        getAttributes: (match) => ({ name: match[1]?.trim() || "nome_do_cliente" }),
      }),
    ];
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /\{\{([^}]+)\}\}$/,
        type: this.type,
        getAttributes: (match) => ({ name: match[1]?.trim() || "nome_do_cliente" }),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => {
      const label = `👤 ${props.node.attrs.name || "nome_do_cliente"}`;
      return (
        <NodeViewWrapper as="span" className="inline-block align-middle mx-0.5 my-1">
          <span
            contentEditable={false}
            onMouseDown={stopEditorEvent}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium transition-all select-none",
              "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15",
              props.selected && "ring-2 ring-primary ring-offset-1 ring-offset-background"
            )}
            title={props.node.attrs.name || "nome_do_cliente"}
          >
            <span className="truncate max-w-[200px]">{label}</span>
            <button
              type="button"
              tabIndex={-1}
              contentEditable={false}
              onMouseDown={stopEditorEvent}
              onClick={(e) => { stopEditorEvent(e); props.deleteNode(); }}
              className="shrink-0 hover:text-destructive hover:bg-destructive/10 rounded-full p-0.5 transition-colors"
              aria-label="Remover variável"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        </NodeViewWrapper>
      );
    });
  },
});

export const SpintaxNode = Node.create({
  name: "spintax",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { onOpenModal: (_pos: number, _options: string[]) => {} };
  },

  addAttributes() {
    return {
      options: {
        default: [],
        parseHTML: (element) => {
          const d = element.getAttribute("data-options");
          if (!d) return [];
          try { const p = JSON.parse(d); return Array.isArray(p) ? p : []; } catch { return []; }
        },
        renderHTML: (attributes) => ({
          "data-options": JSON.stringify(Array.isArray(attributes.options) ? attributes.options : []),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="spintax"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const opts = Array.isArray(node.attrs.options) ? node.attrs.options : [];
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "spintax" }), `{spin:${opts.join("|")}}`];
  },

  renderText({ node }) {
    const opts = Array.isArray(node.attrs.options) ? node.attrs.options : [];
    return `{spin:${opts.join("|")}}`;
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: /\{spin:([^}]+)\}/g,
        type: this.type,
        getAttributes: (match) => ({
          options: match[1] ? match[1].split("|").map((s: string) => s.trim()).filter(Boolean) : [],
        }),
      }),
    ];
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /\{spin:([^}]+)\}$/,
        type: this.type,
        getAttributes: (match) => ({
          options: match[1] ? match[1].split("|").map((s: string) => s.trim()).filter(Boolean) : [],
        }),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => {
      const safeOptions = Array.isArray(props.node.attrs.options) ? props.node.attrs.options : [];
      const displayText = safeOptions.length > 0 ? safeOptions.join(" | ") : "Vazio";

      const handleEdit = (e?: React.MouseEvent) => {
        if (e) stopEditorEvent(e);
        const pos = typeof props.getPos === "function" ? props.getPos() : null;
        if (typeof pos !== "number") return;
        props.extension.options.onOpenModal(pos, safeOptions);
      };

      return (
        <NodeViewWrapper as="span" className="inline-block align-middle mx-0.5 my-1">
          <span
            contentEditable={false}
            onMouseDown={stopEditorEvent}
            onClick={handleEdit}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium transition-all cursor-pointer group select-none",
              "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80",
              props.selected && "ring-2 ring-ring ring-offset-1 ring-offset-background"
            )}
            title={displayText}
          >
            <span className="truncate max-w-[200px]">🎲 {displayText}</span>
            <button
              type="button"
              tabIndex={-1}
              contentEditable={false}
              onMouseDown={stopEditorEvent}
              onClick={(e) => { stopEditorEvent(e); props.deleteNode(); }}
              className="shrink-0 hover:text-destructive hover:bg-destructive/10 rounded-full p-0.5 transition-colors"
              aria-label="Remover spintax"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        </NodeViewWrapper>
      );
    });
  },
});

export function generatePreviewText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "variable") return "João";
  if (node.type === "spintax") {
    const options = Array.isArray(node.attrs?.options) ? node.attrs.options : [];
    return options[Math.floor(Math.random() * options.length)] || "";
  }
  if (node.type === "hardBreak") return "\n";
  if (node.content) {
    const childrenText = node.content.map(generatePreviewText).join("");
    return node.type === "paragraph" ? `${childrenText}\n` : childrenText;
  }
  return "";
}

export function docToPlainText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "variable") return `{{${node.attrs?.name || "nome_do_cliente"}}}`;
  if (node.type === "spintax") {
    const opts = Array.isArray(node.attrs?.options) ? node.attrs.options : [];
    return `{spin:${opts.join("|")}}`;
  }
  if (node.type === "hardBreak") return "\n";
  if (node.content) {
    const childrenText = node.content.map(docToPlainText).join("");
    return node.type === "paragraph" ? `${childrenText}\n` : childrenText;
  }
  return "";
}
