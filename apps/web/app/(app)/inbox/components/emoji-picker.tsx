"use client";

import { Smile } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EmojiCategory {
  label: string;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: "Frequentes",
    emojis: ["👍", "❤️", "😂", "🙏", "😊", "🎉", "🔥", "✅", "👏", "😍", "🤝", "💪"],
  },
  {
    label: "Rostos",
    emojis: [
      "😀", "😃", "😄", "😁", "😅", "🤣", "🙂", "😉", "😌", "😗", "😎", "🤩",
      "🥳", "😢", "😭", "😤", "😮", "🤔", "🙄", "😴", "🤒", "🤗", "🫡", "😬",
    ],
  },
  {
    label: "Gestos",
    emojis: ["👋", "🤙", "✌️", "🤞", "👌", "🙌", "👐", "🤲", "☝️", "👇", "👈", "👉"],
  },
  {
    label: "Corações",
    emojis: ["💙", "💚", "💛", "🧡", "💜", "🖤", "🤍", "💖", "💗", "💓", "💞", "💯"],
  },
  {
    label: "Objetos",
    emojis: ["📞", "📅", "📦", "💰", "🧾", "📄", "📌", "⏰", "🚚", "🛒", "⭐", "⚠️"],
  },
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}

/** Picker simples de emoji por categorias (sem dependência externa). */
export function EmojiPicker({ onPick, disabled }: EmojiPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="h-8 w-8 text-muted-foreground"
          aria-label="Inserir emoji"
        >
          <Smile className="h-[18px] w-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <div className="max-h-64 overflow-y-auto p-2">
          {EMOJI_CATEGORIES.map((category) => (
            <div key={category.label} className="mb-1.5">
              <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category.label}
              </p>
              <div className="grid grid-cols-8">
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onPick(emoji)}
                    aria-label={`Emoji ${emoji}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
