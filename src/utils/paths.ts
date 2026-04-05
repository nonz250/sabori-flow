import { fileURLToPath } from "node:url";
import path, { dirname, resolve } from "node:path";
import { homedir } from "node:os";

// ESM で __dirname を代替
// src/utils/ → ../../ = package root
// ビルド後: dist/utils/ → ../../ = package root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- 定数（モジュールレベル） ----------

/** パッケージルート（旧 PROJECT_ROOT） */
export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

/** アプリケーション名（XDG ディレクトリのサブフォルダ名） */
export const APP_NAME = "sabori-flow";

export const PLIST_LABEL = "com.github.sabori-flow";

export const PLIST_DEST_DIR = path.join(
  process.env.HOME || "",
  "Library",
  "LaunchAgents",
);
export const PLIST_DEST_PATH = path.join(
  PLIST_DEST_DIR,
  `${PLIST_LABEL}.plist`,
);

// ---------- パッケージ内部リソース（定数） ----------

/** config.yml.example のパス（パッケージ同梱） */
export const CONFIG_EXAMPLE_PATH = path.join(
  PACKAGE_ROOT,
  "config.yml.example",
);

/** デフォルトプロンプトディレクトリ（パッケージ同梱） */
export const DEFAULT_PROMPTS_DIR = path.join(PACKAGE_ROOT, "prompts");

/** plist テンプレートのパス（パッケージ同梱） */
export const PLIST_TEMPLATE_PATH = path.join(
  PACKAGE_ROOT,
  "launchd",
  `${PLIST_LABEL}.plist.template`,
);

// ---------- ユーザーデータ統合ディレクトリ ----------

/** ~/.sabori-flow — 全ユーザーデータの基底ディレクトリ */
export function getBaseDir(): string {
  return path.join(homedir(), ".sabori-flow");
}

// ---------- 派生パス ----------

/** ~/.sabori-flow/config.yml */
export function getConfigPath(): string {
  return path.join(getBaseDir(), "config.yml");
}

/** パッケージ同梱の config.yml.example（CONFIG_EXAMPLE_PATH と同値） */
export function getConfigExamplePath(): string {
  return CONFIG_EXAMPLE_PATH;
}

/** パッケージ同梱のプロンプトディレクトリ（DEFAULT_PROMPTS_DIR と同値） */
export function getDefaultPromptsDir(): string {
  return DEFAULT_PROMPTS_DIR;
}

/** ~/.sabori-flow/prompts — ユーザーカスタムプロンプトディレクトリ */
export function getUserPromptsDir(): string {
  return path.join(getBaseDir(), "prompts");
}

/** ~/.sabori-flow/logs */
export function getLogsDir(): string {
  return path.join(getBaseDir(), "logs");
}

/** ~/.sabori-flow/{PLIST_LABEL}.plist — 生成済み plist の保存先 */
export function getPlistGeneratedPath(): string {
  return path.join(getBaseDir(), `${PLIST_LABEL}.plist`);
}

/** plist テンプレートのパス（PLIST_TEMPLATE_PATH と同値） */
export function getPlistTemplatePath(): string {
  return PLIST_TEMPLATE_PATH;
}

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
