"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  UploadCloud,
} from "lucide-react";

import { ApiError } from "@/lib/api";
import { uploadAttachment } from "@/lib/inbox/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MAX_UPLOAD_BYTES,
  filenameFromUrl,
  formatFileSize,
  guessMimeType,
  isAllowedUploadMime,
  isHttpUrl,
  messageTypeForMime,
} from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

export interface StagedAttachment {
  kind: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mediaUrl: string;
  mimeType: string;
  filename?: string;
}

interface AttachmentPopoverProps {
  onStage: (attachment: StagedAttachment) => void;
  disabled?: boolean;
}

/**
 * Anexo do composer (CONTRACTS §13): "Por URL" (MVP original, com preview) ou
 * "Enviar arquivo" (upload real via POST /uploads — CONTRACTS §13). As duas
 * abas produzem o MESMO shape de StagedAttachment; o envio acontece no
 * composer (com caption opcional do texto digitado).
 */
export function AttachmentPopover({ onStage, disabled }: AttachmentPopoverProps) {
  const [open, setOpen] = useState(false);

  // -------------------------------------------------------------- aba URL
  const [kind, setKind] = useState<"IMAGE" | "DOCUMENT">("IMAGE");
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [imageError, setImageError] = useState(false);

  // ------------------------------------------------------ aba arquivo
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const validUrl = isHttpUrl(url.trim());
  const trimmedUrl = url.trim();

  const reset = (): void => {
    setUrl("");
    setFilename("");
    setImageError(false);
    setUploadError(null);
    setUploading(false);
    setDragOver(false);
  };

  const stageFromUrl = (): void => {
    if (!validUrl) return;
    const fallback = kind === "IMAGE" ? "image/jpeg" : "application/octet-stream";
    const attachment: StagedAttachment = {
      kind,
      mediaUrl: trimmedUrl,
      mimeType: guessMimeType(trimmedUrl, fallback),
    };
    if (kind === "DOCUMENT") {
      attachment.filename =
        filename.trim().length > 0 ? filename.trim() : filenameFromUrl(trimmedUrl);
    }
    onStage(attachment);
    reset();
    setOpen(false);
  };

  const handleFile = async (file: File): Promise<void> => {
    setUploadError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`Arquivo muito grande (${formatFileSize(file.size)}) — limite de 20 MB.`);
      return;
    }
    if (!isAllowedUploadMime(file.type)) {
      setUploadError("Tipo de arquivo não suportado.");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadAttachment(file);
      onStage({
        kind: messageTypeForMime(result.mimeType),
        mediaUrl: result.mediaUrl,
        mimeType: result.mimeType,
        filename: result.filename,
      });
      reset();
      setOpen(false);
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.friendlyMessage : "Falha ao enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="h-8 w-8 text-muted-foreground"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="h-[18px] w-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-3">
        <Tabs defaultValue="url">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="url">Por URL</TabsTrigger>
            <TabsTrigger value="file">Enviar arquivo</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------- aba URL */}
          <TabsContent value="url" className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { value: "IMAGE", label: "Imagem", icon: ImageIcon },
                  { value: "DOCUMENT", label: "Documento", icon: FileText },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setKind(option.value);
                    setImageError(false);
                  }}
                  aria-pressed={kind === option.value}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors",
                    kind === option.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted-foreground hover:bg-accent",
                  )}
                >
                  <option.icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="attachment-url" className="text-xs text-muted-foreground">
                URL {kind === "IMAGE" ? "da imagem" : "do documento"}
              </Label>
              <Input
                id="attachment-url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setImageError(false);
                }}
                placeholder="https://…"
                className="h-9"
                autoFocus
              />
            </div>

            {kind === "DOCUMENT" ? (
              <div className="space-y-1.5">
                <Label htmlFor="attachment-name" className="text-xs text-muted-foreground">
                  Nome do arquivo (opcional)
                </Label>
                <Input
                  id="attachment-name"
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  placeholder="proposta.pdf"
                  className="h-9"
                />
              </div>
            ) : null}

            {/* Preview antes de anexar */}
            {validUrl ? (
              kind === "IMAGE" ? (
                <div className="overflow-hidden rounded-md border bg-muted/40">
                  {imageError ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">
                      Não foi possível carregar a pré-visualização.
                    </p>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- preview de URL externa
                    <img
                      src={trimmedUrl}
                      alt="Pré-visualização"
                      onError={() => setImageError(true)}
                      className="max-h-40 w-full object-contain"
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2.5 rounded-md border bg-muted/40 p-2.5">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {filename.trim().length > 0 ? filename.trim() : filenameFromUrl(trimmedUrl)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {guessMimeType(trimmedUrl)}
                    </p>
                  </div>
                </div>
              )
            ) : null}

            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!validUrl || (kind === "IMAGE" && imageError)}
              onClick={stageFromUrl}
            >
              Anexar
            </Button>
          </TabsContent>

          {/* -------------------------------------------------- aba arquivo */}
          <TabsContent value="file" className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,audio/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void handleFile(file);
              }}
              disabled={uploading}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-6 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-input hover:bg-accent/50",
                uploading && "pointer-events-none opacity-70",
              )}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Enviando…</span>
                  {/* barra indeterminada (pulse) — feedback visual simples do upload em andamento */}
                  <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <span className="block h-full w-full animate-pulse rounded-full bg-primary/70" />
                  </span>
                </>
              ) : (
                <>
                  <UploadCloud className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs font-medium">
                    Arraste um arquivo aqui ou clique para selecionar
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Imagem, áudio, vídeo (mp4) ou documento — até 20 MB
                  </span>
                </>
              )}
            </button>

            {uploadError ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {uploadError}
              </p>
            ) : null}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
