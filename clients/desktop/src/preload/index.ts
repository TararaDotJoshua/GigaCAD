// The only bridge between the window and the app: named commands and state updates.
import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, CommandName, CommandResult } from '../shared/types.js';

export interface Navigate {
  readonly projectId?: string;
  readonly branch?: string;
  readonly commit?: boolean;
}

const bridge = {
  command: (name: CommandName, ...args: unknown[]): Promise<CommandResult<unknown>> => ipcRenderer.invoke('gigacad:command', name, args),
  onState: (listener: (state: AppState) => void) => {
    const handler = (_event: unknown, state: AppState) => listener(state);
    ipcRenderer.on('gigacad:state', handler);
    return () => void ipcRenderer.off('gigacad:state', handler);
  },
  onNavigate: (listener: (to: Navigate) => void) => {
    const handler = (_event: unknown, to: Navigate) => listener(to);
    ipcRenderer.on('gigacad:navigate', handler);
    return () => void ipcRenderer.off('gigacad:navigate', handler);
  },
};

export type Bridge = typeof bridge;
contextBridge.exposeInMainWorld('gigacad', bridge);
