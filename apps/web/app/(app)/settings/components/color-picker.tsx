"use client";

import { Check } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Paleta padrão para etapas e tags (mesma família do restante do app). */
export const COLOR_PALETTE = [
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#EC4899",
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#84CC16",
  "#10B981",
  "#14B8A6",
  "#0EA5E9",
  "#64748B",
] as const;

export function pickColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length] ?? "#6366F1";
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

/** Bolinha de cor que abre um popover com a paleta de swatches. */
export function ColorPicker({ value, onChange, label = "Cor" }: ColorPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value}`}
          className="h-6 w-6 shrink-0 rounded-full border border-black/10 ring-offset-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2"
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Selecionar cor ${color}`}
              onClick={() => onChange(color)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-black/10 transition-transform hover:scale-110",
              )}
              style={{ backgroundColor: color }}
            >
              {value.toLowerCase() === color.toLowerCase() ? (
                <Check className="h-3.5 w-3.5 text-white drop-shadow" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
