import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, CheckCircle2, FileSpreadsheet, AlertCircle } from "lucide-react";

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

const deduplicateContacts = (contacts: CampaignContactInput[]): CampaignContactInput[] => {
  const map = new Map<string, CampaignContactInput>();

  for (const contact of contacts) {
    if (!contact.number) continue;

    const normalizedContact: CampaignContactInput = {
      name: contact.name.trim(),
      number: contact.number.trim(),
    };

    const existing = map.get(normalizedContact.number);

    if (!existing) {
      map.set(normalizedContact.number, normalizedContact);
      continue;
    }

    if (!existing.name && normalizedContact.name) {
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

    const columns = line
      .split(/[\t,;]+/)
      .map((column) => column.trim())
      .filter(Boolean);

    if (columns.length === 0) continue;

    if (columns.length === 1) {
      const numberOnly = cleanNumber(columns[0]);
      if (numberOnly) {
        contacts.push({ name: "", number: numberOnly });
      }
      continue;
    }

    const firstAsNumber = cleanNumber(columns[0]);
    const secondAsNumber = cleanNumber(columns[1]);

    let name = columns[0] ?? "";
    let number = secondAsNumber;

    if (!secondAsNumber && firstAsNumber) {
      name = columns[1] ?? "";
      number = firstAsNumber;
    }

    if (!number) {
      const numberCandidate = columns.find((column) => /\d/.test(column));
      number = cleanNumber(numberCandidate);
    }

    if (!number) continue;

    contacts.push({
      name,
      number,
    });
  }

  return deduplicateContacts(contacts);
};

export default function StepContatos({ onNext }: StepContatosProps) {
  const [uploadedContacts, setUploadedContacts] = useState<CampaignContactInput[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pastedContacts = useMemo(() => parsePastedContacts(pastedText), [pastedText]);

  const allContacts = useMemo(
    () => deduplicateContacts([...uploadedContacts, ...pastedContacts]),
    [uploadedContacts, pastedContacts]
  );

  const hasContacts = allContacts.length > 0;

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
    }
  }, []);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    void handleReadFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    void handleReadFile(file);

    // Permite selecionar o mesmo arquivo novamente.
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Adicionar Contatos</h2>
        <p className="text-muted-foreground">Importe sua lista de clientes para iniciar a campanha.</p>
      </div>

      <Card className="border-0 shadow-card">
        <CardContent className="p-6 space-y-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleInputChange}
          />

          <div
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center mx-auto mb-4">
              <Upload className="w-6 h-6 text-primary" />
            </div>
            <p className="text-base font-medium mb-1">Arraste sua planilha aqui</p>
            <p className="text-sm text-muted-foreground">ou clique para selecionar</p>
            <div className="flex items-center justify-center gap-2 mt-3 text-xs text-muted-foreground">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Aceita arquivos .xlsx, .xls e .csv</span>
            </div>

            {isParsingFile && (
              <p className="text-xs text-muted-foreground mt-3">Processando arquivo...</p>
            )}

            {!!uploadedFileName && !isParsingFile && (
              <p className="text-xs text-primary mt-3 font-medium">Arquivo carregado: {uploadedFileName}</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">OU</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Cole os números e nomes aqui</label>
            <Textarea
              placeholder={"João, 47999991111\nMaria, 47999992222\nAna\t47999993333"}
              rows={5}
              className="text-base resize-none"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Formato aceito: Nome, Número ou Nome + Tab + Número.
            </p>
          </div>

          {fileError && (
            <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg px-4 py-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">{fileError}</span>
            </div>
          )}

          {hasContacts && (
            <div className="flex items-center gap-3 bg-success/10 text-success rounded-lg px-4 py-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">
                {allContacts.length} contatos válidos prontos para o disparo
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          className="text-base px-8 py-6"
          disabled={!hasContacts || isParsingFile}
          onClick={() => onNext(allContacts)}
        >
          Próximo Passo →
        </Button>
      </div>
    </div>
  );
}
