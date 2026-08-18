"use client";

import { useState } from "react";
import { ArrowLeft, LayoutTemplate } from "lucide-react";

import type { MessageTemplateDto } from "@sm/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChannelTemplates } from "@/lib/settings/hooks";

import {
  TemplateBodyPreview,
  templateBodyText,
} from "../../settings/components/templates-settings";

export interface TemplateSelection {
  templateName: string;
  language: string;
  params: string[];
}

interface TemplatePickerPopoverProps {
  /** Canal WhatsApp da conversa atual — null enquanto não resolvido/indisponível. */
  channelId: string | null;
  onSend: (selection: TemplateSelection) => void;
  disabled?: boolean;
}

/**
 * Botão "Usar modelo" do composer (CONTRACTS §12): lista os templates
 * APROVADOS do canal da conversa, coleta um valor por `{{n}}` do BODY e
 * devolve {templateName, language, params} para o fluxo de envio existente
 * (POST /conversations/:id/messages type TEMPLATE).
 */
export function TemplatePickerPopover({
  channelId,
  onSend,
  disabled,
}: TemplatePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MessageTemplateDto | null>(null);
  const [params, setParams] = useState<string[]>([]);

  // Só busca enquanto o popover está aberto — evita fetch em toda conversa aberta.
  const templatesQuery = useChannelTemplates(open ? channelId : null, "APPROVED");
  const templates = templatesQuery.data ?? [];

  const reset = (): void => {
    setSelected(null);
    setParams([]);
  };

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (!next) reset();
  };

  const selectTemplate = (template: MessageTemplateDto): void => {
    setSelected(template);
    setParams(Array.from({ length: template.bodyParamsCount }, () => ""));
  };

  const canSend = selected !== null && params.every((param) => param.trim().length > 0);

  const handleSend = (): void => {
    if (!selected || !canSend) return;
    onSend({
      templateName: selected.name,
      language: selected.language,
      params: params.map((param) => param.trim()),
    });
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || channelId === null}
          className="h-8 w-8 text-muted-foreground"
          aria-label="Usar modelo"
          title="Usar modelo"
        >
          <LayoutTemplate className="h-[18px] w-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 space-y-3 p-3">
        {selected === null ? (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Obrigatório fora da janela de 24h sem resposta do contato.
            </p>
            {templatesQuery.isLoading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Carregando…
              </p>
            ) : templates.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                Nenhum template aprovado para este canal. Sincronize em
                Configurações → Canais → Templates.
              </p>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5 pr-2.5">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => selectTemplate(template)}
                      className="w-full rounded-md border p-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent"
                    >
                      <span className="block font-mono font-medium">{template.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {templateBodyText(template) || "Sem corpo de texto"}
                      </span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Escolher outro modelo
            </button>

            <div>
              <p className="font-mono text-xs font-medium">{selected.name}</p>
              <TemplateBodyPreview text={templateBodyText(selected)} />
            </div>

            {params.length > 0 ? (
              <div className="space-y-2">
                {params.map((value, index) => (
                  <div key={index} className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      {`{{${index + 1}}}`}
                    </Label>
                    <Input
                      value={value}
                      onChange={(event) =>
                        setParams((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        )
                      }
                      className="h-8 text-xs"
                      placeholder={`Valor do parâmetro ${index + 1}`}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!canSend}
              onClick={handleSend}
            >
              Enviar modelo
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
