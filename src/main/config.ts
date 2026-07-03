import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

const file = () => path.join(app.getPath("userData"), "config.json");

export function getApiKey(): string | null {
  // Dev convenience: .env (loaded via dotenv in main/index.ts) wins over stored key.
  if (process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.startsWith("sk-REPLACE")) {
    return process.env.DEEPSEEK_API_KEY;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return safeStorage.decryptString(Buffer.from(raw.apiKey, "base64"));
  } catch { return null; }
}

export function setApiKey(key: string): void {
  const enc = safeStorage.encryptString(key).toString("base64");
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ apiKey: enc }));
}

export function sessionDir(): string {
  const d = path.join(app.getPath("userData"), "sessions");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
