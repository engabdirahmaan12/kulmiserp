'use client';

import { create } from 'zustand';

const FAB_STORAGE_KEY = 'kulmis-ai-fab-expanded';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: { label: string; href: string }[];
  source?: 'llm' | 'rules';
  createdAt: number;
}

interface AiCopilotState {
  open: boolean;
  fabExpanded: boolean;
  fabHydrated: boolean;
  messages: AiChatMessage[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  collapseFab: () => void;
  expandFab: () => void;
  toggleFab: () => void;
  hydrateFabPreference: () => void;
  newChat: () => void;
  addMessage: (msg: Omit<AiChatMessage, 'id' | 'createdAt'>) => void;
  updateLastAssistant: (content: string, extras?: Partial<AiChatMessage>) => void;
}

export const useAiCopilotStore = create<AiCopilotState>((set, get) => ({
  open: false,
  fabExpanded: true,
  fabHydrated: false,
  messages: [],
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  collapseFab: () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FAB_STORAGE_KEY, 'collapsed');
    }
    set({ fabExpanded: false, open: false });
  },
  expandFab: () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FAB_STORAGE_KEY, 'expanded');
    }
    set({ fabExpanded: true });
  },
  toggleFab: () => {
    if (get().fabExpanded) get().collapseFab();
    else get().expandFab();
  },
  hydrateFabPreference: () => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(FAB_STORAGE_KEY);
    // migrate old key
    const legacy = localStorage.getItem('kulmis-ai-fab-visible');
    const expanded =
      stored === 'expanded' || (stored === null && legacy !== 'hidden');
    set({ fabExpanded: expanded, fabHydrated: true });
  },
  newChat: () => set({ messages: [] }),
  addMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          ...msg,
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: Date.now(),
        },
      ],
    })),
  updateLastAssistant: (content, extras) =>
    set((s) => {
      const messages = [...s.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          messages[i] = { ...messages[i], content, ...extras };
          break;
        }
      }
      return { messages };
    }),
}));

export function openAiCopilot() {
  const state = useAiCopilotStore.getState();
  if (!state.fabExpanded) state.expandFab();
  state.setOpen(true);
}
