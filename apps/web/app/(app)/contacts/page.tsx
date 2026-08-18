import type { Metadata } from "next";

import { ContactsClient } from "./components/contacts-client";

export const metadata: Metadata = { title: "Contatos" };

export default function ContactsPage() {
  return <ContactsClient />;
}
