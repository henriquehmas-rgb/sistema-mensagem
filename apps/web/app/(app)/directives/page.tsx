import type { Metadata } from "next";
import { DirectivesClient } from "./components/directives-client";
export const metadata: Metadata = { title: "Diretrizes" };
export default function DirectivesPage() { return <DirectivesClient />; }
