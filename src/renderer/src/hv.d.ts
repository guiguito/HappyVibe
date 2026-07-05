declare global {
  interface HvByokProvider {
    id: string;
    label: string;
    source: "env" | "stored" | null;
  }

  interface HvModel {
    provider: string;
    id: string;
    name: string;
  }
}

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
  onPiEvent(cb: (e: Record<string, unknown>) => void): () => void;
  onUiRequest(cb: (r: { id: string; method?: string; title?: string; message?: string; options?: string[] }) => void): () => void;
  onPiExit(cb: (info: { code: number | null }) => void): () => void;
  // B3: providers & onboarding
  respondInput(id: string, value: string | null): void;
  getProviders(): Promise<{ byok: HvByokProvider[]; defaultModel: { provider: string; modelId: string } | null }>;
  setProviderKey(provider: string, key: string): Promise<void>;
  removeProviderKey(provider: string): Promise<void>;
  authLogin(provider: string): Promise<void>;
  authLoginCancel(provider: string): Promise<void>;
  authLogout(provider: string): Promise<void>;
  authStatus(): Promise<void>;
  detectOllama(): Promise<{ running: boolean; models: string[] }>;
  listModels(): Promise<HvModel[]>;
  setDefaultModel(provider: string, modelId: string): Promise<void>;
  hasAnyProvider(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    hv: HvApi;
  }
}

export {};
