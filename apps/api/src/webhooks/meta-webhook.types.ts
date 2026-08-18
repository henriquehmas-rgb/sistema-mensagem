/**
 * Formas relevantes do payload de webhook da Meta (WhatsApp Cloud API).
 * Campos não mapeados são ignorados — o payload cru fica em WebhookEventLog.
 */

export interface MetaWebhookBody {
  object?: string; // 'whatsapp_business_account' | 'instagram' | ...
  entry?: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id?: string;
  changes?: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  field?: string; // 'messages'
  value?: MetaWebhookValue;
}

export interface MetaWebhookValue {
  messaging_product?: string; // 'whatsapp'
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
}

export interface MetaWebhookContact {
  wa_id?: string;
  profile?: { name?: string };
}

export interface MetaWebhookMessage {
  id?: string; // wamid
  from?: string; // wa_id do remetente
  timestamp?: string;
  type?: string; // text | image | audio | video | document | sticker | location | ...
  text?: { body?: string };
  image?: MetaWebhookMedia;
  audio?: MetaWebhookMedia;
  video?: MetaWebhookMedia;
  document?: MetaWebhookMedia & { filename?: string };
  sticker?: MetaWebhookMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

export interface MetaWebhookMedia {
  id?: string; // media id da Graph API (URL expira; download autenticado)
  mime_type?: string;
  sha256?: string;
  caption?: string;
}

export interface MetaWebhookStatus {
  id?: string; // wamid da mensagem OUTBOUND
  status?: string; // sent | delivered | read | failed
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}
