import path from "path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

// ESM で __dirname を代替
// src/utils/ → ../../ = project root
// ビルド後: dist/utils/ → ../../ = project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export const CONFIG_PATH = path.join(PROJECT_ROOT, "config.yml");
export const CONFIG_EXAMPLE_PATH = path.join(
  PROJECT_ROOT,
  "config.yml.example",
);
export const LOGS_DIR = path.join(PROJECT_ROOT, "logs");

export const PLIST_LABEL = "com.github.nonz250.sabori-flow";
export const PLIST_TEMPLATE_PATH = path.join(
  PROJECT_ROOT,
  "launchd",
  `${PLIST_LABEL}.plist.template`,
);
export const PLIST_GENERATED_PATH = path.join(
  PROJECT_ROOT,
  "launchd",
  `${PLIST_LABEL}.plist`,
);
export const PLIST_DEST_DIR = path.join(
  process.env.HOME || "",
  "Library",
  "LaunchAgents",
);
export const PLIST_DEST_PATH = path.join(
  PLIST_DEST_DIR,
  `${PLIST_LABEL}.plist`,
);

// ---------- Tilde expansion ----------

export function expandTilde(filePath: string): string {
  if (filePath === "~") {
    return homedir();
  }
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return filePath;
}
