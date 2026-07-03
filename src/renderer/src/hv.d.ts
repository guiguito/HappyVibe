interface HvApi {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  startSession(workspace: string): Promise<void>;
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
  getStats(): Promise<unknown>;
  respondPermission(id: string, choice: string): void;
  restartPi(): Promise<void>;
  onPiEvent(cb: (e: Record<string, unknown>) => void): void;
  onUiRequest(cb: (r: { id: string; method?: string; title?: string; options?: string[] }) => void): void;
  onPiExit(cb: (info: { code: number | null }) => void): void;
}

declare global {
  interface Window {
    hv: HvApi;
  }
}

export {};
