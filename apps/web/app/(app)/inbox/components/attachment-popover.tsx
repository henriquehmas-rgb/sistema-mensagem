"use client";

import { useState } from "react";
import { FileText, ImageIcon, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { filenameFromUrl, guessMimeType, isHttpUrl } from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

export interface StagedAttachment {
  kind: "IMAGE" | "DOCUMENT";
  mediaUrl: string;
  mimeType: string;
  filename?: string;
}

interface AttachmentPopoverProps {
  onStage: (attachment: StagedAttachment) => void;
  disabled?: boolean;
}

/**
 * Anexo por URL (MVP): imagem ou documento, com preview antes de anexar.
 * O envio acontece no composer (com caption opcional do texto digitado).
 */
export function AttachmentPopover({ onStage, disabled }: AttachmentPopoverProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<StagedAttachment["kind"]>("IMAGE");
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [imageError, setImageError] = useState(false);

  const validUrl = isHttpUrl(url.trim());
  const trimmedUrl = url.trim();

  const reset = (): void => {
    setUrl("");
    setFilename("");
    setImageError(false);
  };

  const stage = (): void => {
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
      <PopoverContent align="start" side="top" className="w-80 space-y-3 p-3">
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
          onClick={stage}
        >
          Anexar
        </Button>
      </PopoverContent>
    </Popover>
  );
}
