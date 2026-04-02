import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  Download,
  Trash2,
  Users
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CampaignContactInput = {
  name: string;
  number: string;
};

type StepContatosProps = {
  onNext: (contacts: CampaignContactInput[]) => void;
};

const normalizeHeader = (value: unknown): string => {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
};

const cleanNumber = (value: unknown): string => {
  return String(value ?? "").replace(/\D/g, "").trim();
};

const looksLikeNameHeader = (header: string): boolean => {
  return /(nome|name|contato|cliente)/i.test(header);
};

const looksLikePhoneHeader = (header: string): boolean => {
  return /(telefone|fone|numero|celular|whatsapp|phone)/i.test(header);
};

const PHONE_CANDIDATE_REGEX = /\+?\d[\d\s().-]{6,}\d/g;

const deduplicateContacts = (contacts: CampaignContactInput[]): CampaignContactInput[] => {
  const map = new Map<string, CampaignContactInput>();

  for (const contact of contacts) {
    if (!contact.number) continue;

    const normalizedContact: CampaignContactInput = {
      name: contact.name.trim(),
      number: contact.number.trim(),
    };

    if (!map.has(normalizedContact.number)) {
      map.set(normalizedContact.number, normalizedContact);
    }
  }

  return Array.from(map.values());
};

const parseSheetRows = (rows: unknown[][]): CampaignContactInput[] => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const normalizedRows = rows.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []
  );

  const firstRow = normalizedRows[0] ?? [];
  const normalizedHeaders = firstRow.map(normalizeHeader);

  const nameHeaderIndex = normalizedHeaders.findIndex(looksLikeNameHeader);
  const phoneHeaderIndex = normalizedHeaders.findIndex(looksLikePhoneHeader);
  const hasHeader = nameHeaderIndex >= 0 || phoneHeaderIndex >= 0;

  const nameIndex = nameHeaderIndex >= 0 ? nameHeaderIndex : 0;
  const phoneIndex = phoneHeaderIndex >= 0 ? phoneHeaderIndex : 1;
  const dataStartIndex = hasHeader ? 1 : 0;

  const contacts: CampaignContactInput[] = [];

  for (let i = dataStartIndex; i < normalizedRows.length; i += 1) {
    const row = normalizedRows[i];
    if (!row || row.every((cell) => !String(cell).trim())) {
      continue;
    }

    const rawName = String(row[nameIndex] ?? "").trim();
    let rawNumber = String(row[phoneIndex] ?? "").trim();

    if (!rawNumber) {
      rawNumber = row.find((cell) => /\d/.test(String(cell))) ?? "";
    }

    const number = cleanNumber(rawNumber);

    if (!number) {
      continue;
    }

    contacts.push({
      name: rawName,
      number,
    });
  }

  return deduplicateContacts(contacts);
};

const parsePastedContacts = (input: string): CampaignContactInput[] => {
  if (!input.trim()) {
    return [];
  }

  const contacts: CampaignContactInput[] = [];
  const lines = input.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const phoneMatches = line.match(PHONE_CANDIDATE_REGEX) ?? [];

    let bestRawPhone = "";
    let bestCleanedPhone = "";

    for (const candidate of phoneMatches) {
      const cleanedCandidate = cleanNumber(candidate);
      if (cleanedCandidate.length < 8) continue;

      if (cleanedCandidate.length > bestCleanedPhone.length) {
        bestRawPhone = candidate;
        bestCleanedPhone = cleanedCandidate;
      }
    }

    if (!bestCleanedPhone) {
      continue;
    }

    const name = line
      .replace(bestRawPhone, " ")
      .replace(/[|,;:\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    contacts.push({
      name,
      number: bestCleanedPhone,
    });
  }

  return deduplicateContacts(contacts);
};

export default function StepContatos({ onNext }: StepContatosProps) {
  const [inputMode, setInputMode] = useState<"upload" | "paste">("upload");
  const [isDragging, setIsDragging] = useState(false);

  const [uploadedContacts, setUploadedContacts] = useState<CampaignContactInput[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [pastedText, setPastedText] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pastedContacts = useMemo(() => parsePastedContacts(pastedText), [pastedText]);

  // Apenas os contatos da aba ativa serão considerados
  const activeContacts = inputMode === "upload" ? uploadedContacts : pastedContacts;
  const hasContacts = activeContacts.length > 0;

  const handleReadFile = useCallback(async (file: File) => {
    setIsParsingFile(true);
    setFileError(null);

    try {
      const fileExtension = file.name.toLowerCase();
      if (!fileExtension.endsWith(".xlsx") && !fileExtension.endsWith(".xls") && !fileExtension.endsWith(".csv")) {
        throw new Error("Formato inválido. Use .xlsx, .xls ou .csv.");
      }

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error("Nenhuma aba encontrada no arquivo.");
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      const contacts = parseSheetRows(rows as unknown[][]);

      if (contacts.length === 0) {
        throw new Error("Nenhum contato válido encontrado. Verifique as colunas de nome e número.");
      }

      setUploadedFileName(file.name);
      setUploadedContacts(contacts);
    } catch (error) {
      console.error("[contacts] Falha ao ler arquivo:", error);
      setUploadedContacts([]);
      setUploadedFileName("");
      setFileError(error instanceof Error ? error.message : "Erro ao processar arquivo.");
    } finally {
      setIsParsingFile(false);
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    void handleReadFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    void handleReadFile(file);
    e.target.value = "";
  };

  const handleClearFile = () => {
    setUploadedContacts([]);
    setUploadedFileName("");
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownloadXlsxTemplate = () => {
    const sheetRows = [
      ["nome", "numero"],
      ["Joao Silva", "47999991111"],
      ["Maria Oliveira", "47999992222"],
      ["Contato sem nome", "47999993333"],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Contatos");
    XLSX.writeFile(workbook, "template-contatos.xlsx");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Adicionar Contatos</h2>
        <p className="text-muted-foreground">Importe sua lista de clientes para iniciar a campanha.</p>
      </div>

      <Card className="border-0 shadow-card">
        <CardContent className="p-6">
          <Tabs
            defaultValue="upload"
            value={inputMode}
            onValueChange={(val) => setInputMode(val as "upload" | "paste")}
            className="w-full"
          >
            <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
              <TabsTrigger value="upload" className="text-sm">Importar Planilha</TabsTrigger>
              <TabsTrigger value="paste" className="text-sm">Colar Manualmente</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4 outline-none">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleInputChange}
              />

              {uploadedFileName ? (
                <div className="border border-border bg-muted/30 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in zoom-in-95">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{uploadedFileName}</p>
                      <p className="text-sm text-muted-foreground">{uploadedContacts.length} contatos identificados</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleClearFile} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remover
                  </Button>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 transition-all duration-200 ease-in-out flex flex-col items-center justify-center text-center cursor-pointer group",
                    isDragging
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                  )}
                >
                  <div className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-colors",
                    isDragging ? "bg-primary text-primary-foreground" : "bg-secondary text-primary group-hover:bg-primary/10"
                  )}>
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-base font-medium mb-1">
                    {isDragging ? "Solte o arquivo aqui" : "Arraste sua planilha aqui"}
                  </p>
                  <p className="text-sm text-muted-foreground">ou clique para selecionar no computador</p>

                  <div className="flex items-center justify-center gap-2 mt-4 text-xs text-muted-foreground font-medium bg-background px-3 py-1.5 rounded-md shadow-sm border border-border/50">
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Formatos aceitos: .xlsx, .xls, .csv</span>
                  </div>

                  {isParsingFile && (
                    <p className="text-xs text-primary animate-pulse mt-4 font-medium">Processando contatos...</p>
                  )}
                </div>
              )}

              {!uploadedFileName && (
                <div className="flex justify-start pt-2">
                  <Button variant="link" size="sm" className="text-muted-foreground hover:text-primary gap-2 px-0" onClick={handleDownloadXlsxTemplate}>
                    <Download className="w-4 h-4" />
                    Baixar planilha de exemplo
                  </Button>
                </div>
              )}

              {fileError && (
                <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg px-4 py-3 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span className="text-sm font-medium">{fileError}</span>
                </div>
              )}
            </TabsContent>

            <TabsContent value="paste" className="space-y-4 outline-none">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Lista de Números</label>
                  {pastedText.trim().length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setPastedText("")} className="h-8 text-muted-foreground hover:text-destructive">
                      Limpar texto
                    </Button>
                  )}
                </div>
                <Textarea
                  placeholder={"Exemplos aceitos:\n\nJoão, 47999991111\nMaria Silva - (47) 9999-2222\n47999993333"}
                  rows={8}
                  className="text-base resize-none font-mono"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Cole um contato por linha. O sistema identificará automaticamente o nome e o telefone.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {hasContacts && (
            <div className="mt-8 border border-success/20 bg-success/5 rounded-xl p-5 animate-in fade-in zoom-in-95">
              <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
                <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                </div>
                <div className="flex-1">
                  {/* Cor alterada para text-green-800 para melhor contraste */}
                  <h4 className="text-sm font-bold text-green-800 mb-1">
                    {activeContacts.length} {activeContacts.length === 1 ? "contato pronto" : "contatos prontos"} para envio
                  </h4>

                  {/* Mini Preview Inteligente */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {activeContacts.slice(0, 3).map((contact, idx) => (
                      <Badge key={idx} variant="secondary" className="bg-background/50 border-success/20 text-xs font-normal">
                        <Users className="w-3 h-3 mr-1.5 opacity-50 text-green-700" />
                        <span className="truncate max-w-[120px] font-medium mr-1 text-green-900">{contact.name || "Sem nome"}</span>
                        <span className="text-muted-foreground">{contact.number}</span>
                      </Badge>
                    ))}
                    {activeContacts.length > 3 && (
                      <Badge variant="outline" className="text-xs bg-transparent border-dashed text-green-800 border-green-300">
                        + {activeContacts.length - 3} contatos
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          className="text-base px-8 py-6 shadow-lg hover:shadow-primary/20 transition-all"
          disabled={!hasContacts || isParsingFile}
          onClick={() => onNext(activeContacts)}
        >
          Próximo Passo →
        </Button>
      </div>
    </div>
  );
}