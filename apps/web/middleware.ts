import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/constants";

const PROTECTED_PREFIXES = [
  "/inbox",
  "/kanban",
  "/contacts",
  "/dashboard",
  "/settings",
] as const;

/**
 * Guard leve baseado no cookie-sinalizador de sessão (sem valor sensível).
 * A proteção real é o guard client-side no layout autenticado + o JWT exigido
 * pela API; aqui apenas evitamos flash de telas privadas para visitantes.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = request.cookies.has(AUTH_COOKIE_NAME);

  if (pathname === "/") {
    return NextResponse.redirect(
      new URL(isAuthenticated ? "/inbox" : "/login", request.url),
    );
  }

  if (pathname === "/login" && isAuthenticated) {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/inbox/:path*",
    "/kanban/:path*",
    "/contacts/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
  ],
};
