import { create } from "zustand";

/** Quem está digitando em uma conversa (contato ou agente). */
export interface TypingState {
  isTyping: boolean;
  contactId?: string;
  userId?: string;
}

interface InboxUiState {
  /** Conversa aberta na thread — usada p/ suprimir toast/som e auto-read. */
  activeConversationId: string | null;
  /** Painel CRM (direita) aberto. */
  crmOpen: boolean;
  /** Estado "digitando…" por conversa (alimentado pelo realtime). */
  typingByConversation: Record<string, TypingState>;
  setActiveConversation: (id: string | null) => void;
  setCrmOpen: (open: boolean) => void;
  toggleCrm: () => void;
  setTyping: (conversationId: string, state: TypingState) => void;
  clearTyping: (conversationId: string) => void;
  /** Volta ao estado inicial — chamado no encerramento da sessão (logout/401). */
  reset: () => void;
}

const INITIAL_STATE = {
  activeConversationId: null,
  crmOpen: true,
  typingByConversation: {},
} satisfies Pick<
  InboxUiState,
  "activeConversationId" | "crmOpen" | "typingByConversation"
>;

export const useInboxStore = create<InboxUiState>((set) => ({
  ...INITIAL_STATE,

  setActiveConversation: (id) => set({ activeConversationId: id }),
  setCrmOpen: (open) => set({ crmOpen: open }),
  toggleCrm: () => set((state) => ({ crmOpen: !state.crmOpen })),

  setTyping: (conversationId, typing) =>
    set((state) => ({
      typingByConversation: { ...state.typingByConversation, [conversationId]: typing },
    })),

  clearTyping: (conversationId) =>
    set((state) => {
      const { [conversationId]: _removed, ...rest } = state.typingByConversation;
      return { typingByConversation: rest };
    }),

  reset: () => set({ ...INITIAL_STATE }),
}));
