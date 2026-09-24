import type { Metadata } from "next";
import { ProtocolsClient } from "./components/protocols-client";

export const metadata: Metadata = { title: "Protocolos" };

export default function ProtocolsPage() {
  return <ProtocolsClient />;
}
