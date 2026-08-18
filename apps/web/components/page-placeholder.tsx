import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface PagePlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  hint?: string;
}

/** Cabeçalho + estado vazio consistente para páginas ainda em construção. */
export function PagePlaceholder({
  icon: Icon,
  title,
  description,
  hint,
}: PagePlaceholderProps) {
  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
        <Icon className="h-5 w-5 text-primary" />
        <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
      </header>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col items-center text-center animate-fade-up">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Icon className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          {hint ? (
            <Badge variant="secondary" className="mt-5">
              {hint}
            </Badge>
          ) : null}

          <div className="mt-8 w-full space-y-3 opacity-60" aria-hidden>
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
