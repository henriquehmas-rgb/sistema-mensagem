"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Tag as TagIcon, Trash2 } from "lucide-react";

import type { TagDto } from "@sm/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateTag, useTags } from "@/lib/inbox/hooks";
import { useDeleteTag, useUpdateTag } from "@/lib/settings/hooks";

import { COLOR_PALETTE, ColorPicker } from "./color-picker";

function TagCard({ tag }: { tag: TagDto }) {
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [draft, setDraft] = useState(tag.name);

  useEffect(() => {
    setDraft(tag.name);
  }, [tag.name]);

  const commitName = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== tag.name) {
      updateTag.mutate({ id: tag.id, input: { name: trimmed } });
    } else {
      setDraft(tag.name);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
      <ColorPicker
        value={tag.color}
        onChange={(color) => updateTag.mutate({ id: tag.id, input: { color } })}
        label={`Cor da tag ${tag.name}`}
      />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName();
          if (event.key === "Escape") setDraft(tag.name);
        }}
        aria-label={`Nome da tag ${tag.name}`}
        className="h-8 flex-1 border-transparent bg-transparent text-sm font-medium shadow-none hover:border-input focus-visible:border-input"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        disabled={deleteTag.isPending}
        onClick={() => deleteTag.mutate(tag.id)}
        aria-label={`Excluir tag ${tag.name}`}
      >
        {deleteTag.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

export function TagsSettings() {
  const tagsQuery = useTags();
  const createTag = useCreateTag();

  const tags = tagsQuery.data ?? [];

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(COLOR_PALETTE[4]);

  const handleCreate = (event: React.FormEvent): void => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0 || createTag.isPending) return;
    createTag.mutate(
      { name, color: newColor },
      { onSuccess: () => setNewName("") },
    );
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Tags</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Classifique conversas com tags coloridas — usadas em filtros, kanban e
          automações.
        </p>
      </div>

      {tagsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
          <TagIcon className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">Nenhuma tag ainda</p>
          <p className="text-xs text-muted-foreground">
            Crie a primeira tag no formulário abaixo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} />
          ))}
        </div>
      )}

      {/* Criar tag */}
      <form
        onSubmit={handleCreate}
        className="flex max-w-md items-end gap-2 rounded-lg border border-dashed p-3"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="new-tag-name" className="text-xs">
            Nova tag
          </Label>
          <div className="flex items-center gap-2">
            <ColorPicker value={newColor} onChange={setNewColor} label="Cor da nova tag" />
            <Input
              id="new-tag-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: VIP"
              className="h-9"
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={newName.trim().length === 0 || createTag.isPending}
        >
          {createTag.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Criar
        </Button>
      </form>
    </div>
  );
}
