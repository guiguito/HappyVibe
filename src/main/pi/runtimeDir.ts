import path from "node:path";
import { app } from "electron";

/**
 * Returns the absolute path to the pi-runtime directory.
 * In packaged mode (app.isPackaged), it lives in <resources>/pi-runtime.
 * In dev mode, it lives at <repo>/pi-runtime (relative to cwd).
 *
 * This module intentionally lives SEPARATE from spawn.ts so that spawn.ts
 * remains electron-free and importable by Vitest unit tests.
 */
export function piRuntimeDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "pi-runtime")
    : path.join(process.cwd(), "pi-runtime");
}
