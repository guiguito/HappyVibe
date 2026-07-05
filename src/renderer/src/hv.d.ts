declare global {
/** Mirrors SessionMeta in src/main/store.ts (separate tsconfig roots — kept in sync by hand). */
interface SessionMeta {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  piSessionFile?: string;
  titleSource: "fallback" | "model" | "user";
}

interface SimpleMessage {
  role: "user" | "assistant";
  text: string;
}

interface HvApi {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  getStats(sessionId?: string): Promise<unknown>;
  respondPermission(id: string, choice: string): void;

  listWorkspaces(): Promise<string[]>;
  addWorkspace(): Promise<string | null>;
  removeWorkspace(ws: string): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  createSession(workspaceId: string): Promise<SessionMeta>;
  openSession(sessionId: string): Promise<{ meta: SessionMeta; messages: SimpleMessage[] | null }>;
  closeSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  promptSession(sessionId: string, msg: string): Promise<void>;
  abortSession(sessionId: string): Promise<void>;

  onPiEvent(cb: (e: Record<string, unknown>) => void): () => void;
  onUiRequest(
    cb: (r: { id: string; sessionId?: string; method?: string; title?: string; options?: string[] }) => void
  ): () => void;
  onPiExit(cb: (info: { sessionId: string; code: number | null; intentional: boolean }) => void): () => void;
  onSessionsChanged(cb: (sessions: SessionMeta[]) => void): () => void;
}

  interface Window {
    hv: HvApi;
  }
}

export {};
