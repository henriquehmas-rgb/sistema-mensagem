"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";

const Avatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full",
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full object-cover", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

/**
 * Paleta de fallback — classes literais para o scanner do Tailwind.
 * A cor é determinística por hash do nome (mesmo nome → mesma cor).
 */
const AVATAR_COLORS = [
  "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300",
  "bg-violet-500/20 text-violet-600 dark:text-violet-300",
  "bg-sky-500/20 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/20 text-amber-600 dark:text-amber-300",
  "bg-rose-500/20 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/20 text-cyan-600 dark:text-cyan-300",
  "bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300",
] as const;

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

interface UserAvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  name: string;
  src?: string | null;
}

/** Avatar composto: imagem quando houver, senão iniciais coloridas por hash do nome. */
const UserAvatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  UserAvatarProps
>(({ name, src, className, ...props }, ref) => (
  <Avatar ref={ref} className={className} {...props}>
    {src ? <AvatarImage src={src} alt={name} /> : null}
    <AvatarFallback className={getAvatarColor(name)}>
      {getInitials(name)}
    </AvatarFallback>
  </Avatar>
));
UserAvatar.displayName = "UserAvatar";

export { Avatar, AvatarImage, AvatarFallback, UserAvatar };
