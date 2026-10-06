import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'ok' | 'error';
}

interface ToastStore {
  toasts: Toast[];
  push: (message: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastStore>()((set, get) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { id, message, kind }] });
    setTimeout(() => get().dismiss(id), 3600);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (message: string, kind?: Toast['kind']) => useToasts.getState().push(message, kind);
