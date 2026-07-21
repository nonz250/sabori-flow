import fs from "fs";
import { getAuthTokenPath, getBaseDir } from "./paths.js";

export function readAuthToken(): string | null {
  try {
    const trimmed = fs.readFileSync(getAuthTokenPath(), "utf-8").trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string): void {
  const filePath = getAuthTokenPath();
  fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, token.trim(), { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}
