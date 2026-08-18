"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

/** Lightbox de imagem com zoom (botões +/−/reset e clique para alternar). */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (src) setZoom(1);
  }, [src]);

  const clamp = (value: number): number =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

  return (
    <Dialog open={src !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl gap-3 p-3">
        <DialogHeader className="sr-only">
          <DialogTitle>Visualizar imagem</DialogTitle>
          <DialogDescription>
            Imagem da conversa em tamanho ampliado. Use os botões para ajustar o zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[75vh] items-center justify-center overflow-auto rounded-lg bg-black/90">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- mídia externa dos canais
            <img
              src={src}
              alt={alt ?? "Imagem da conversa"}
              onClick={() => setZoom((value) => (value === 1 ? 2 : 1))}
              style={{ transform: `scale(${zoom})` }}
              className="max-h-[73vh] cursor-zoom-in select-none object-contain transition-transform duration-200"
              draggable={false}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoom((value) => clamp(value - ZOOM_STEP))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Diminuir zoom"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-14 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoom((value) => clamp(value + ZOOM_STEP))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Aumentar zoom"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            aria-label="Restaurar zoom"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
