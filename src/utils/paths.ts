import path from "path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
