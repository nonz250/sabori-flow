import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { Language } from "../i18n/types.js";
import type { Issue, RepositoryConfig } from "./models.js";
import { Phase, repoFullName } from "./models.js";
import { getUserPromptsDir, getDefaultPromptsDir } from "../utils/paths.js";
import { createLogger } from "./logger.js";

/** テンプレート関連のエラー */
export class PromptTemplateError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, PromptTemplateError.prototype);
  }
}

const logger = createLogger("prompt");

export const TEMPLATE_FILES: Record<Phase, string> = {
  [Phase.PLAN]: "plan.md",
  [Phase.IMPL]: "impl.md",
};

/** テンプレートファイルの最大サイズ (100KB) */
const MAX_TEMPLATE_SIZE = 100 * 1024;

/** バウンダリプレースホルダ（セキュリティ上必須） */
const REQUIRED_BOUNDARY_PLACEHOLDERS = [
  "{boundary_open}",
  "{boundary_close}",
] as const;

/**
 * ユーザー入力由来の変数キー。
 * 二重展開防止のため、これらは最後に展開する。
 */
const USER_INPUT_KEYS: ReadonlySet<string> = new Set([
  "issue_body",
  "issue_title",
]);

/**
 * Issue とリポジトリ設定からプロンプト文字列を組み立てる。
 *
 * テンプレートファイルを読み込み、プレースホルダを展開して返す。
 * 3 段階のフォールバックでテンプレートを解決する:
 *   1. リポジトリ固有のカスタムディレクトリ (`repoConfig.promptsDir`)
 *   2. ユーザー共通ディレクトリ (`~/.sabori-flow/prompts/`)
 *   3. パッケージ同梱のデフォルトテンプレート (`prompts/<language>/`)
 *
 * @throws {PromptTemplateError} テンプレートの読み込みまたは展開に失敗した場合
 */
export function buildPrompt(
  issue: Issue,
  repoConfig: RepositoryConfig,
  language: Language,
): string {
  const customDir = repoConfig.promptsDir;
  const userDir = getUserPromptsDir();
  const defaultDir = join(getDefaultPromptsDir(), language);
  const template = loadTemplate(issue.phase, customDir, userDir, defaultDir);
  const variables = buildVariables(issue, repoConfig);
  return render(template, variables);
}

type TrustLevel = "untrusted" | "trusted";

/**
 * ディレクトリからテンプレートファイルの読み込みを試行する。
 *
 * ファイルが存在すれば内容を返し、存在しなければ null を返す。
 * untrusted ディレクトリの場合はパス包含検証とバウンダリプレースホルダ検証を行う。
 *
 * @throws {PromptTemplateError} ファイルが存在するが検証に失敗した場合
 */
function loadFromDir(
  dir: string,
  filename: string,
  trust: TrustLevel,
): string | null {
  const filePath = resolve(dir, filename);
  if (!existsSync(filePath)) return null;

  if (trust === "untrusted") {
    validatePathContainment(filePath, dir);
  }
  const content = readTemplateFile(filePath);
  if (trust === "untrusted") {
    validateBoundaryPlaceholders(content, filePath);
  }
  return content;
}

/**
 * 3 段階フォールバックでテンプレートファイルを読み込む。
 *
 *   1. リポジトリ固有のカスタムディレクトリ（untrusted: パス検証 + バウンダリ検証）
 *   2. ユーザー共通ディレクトリ（untrusted: パス検証 + バウンダリ検証）
 *   3. パッケージ同梱のデフォルトディレクトリ（trusted: 検証なし）
 *
 * ファイルが存在するが読み込めない/検証に失敗する場合はエラーとする（フォールバックしない）。
 *
 * @throws {PromptTemplateError} フェーズが未定義、テンプレートが存在しない、
 *   バウンダリプレースホルダが欠落、またはファイルサイズ超過の場合
 */
function loadTemplate(
  phase: Phase,
  customDir: string | null,
  userDir: string,
  defaultDir: string,
): string {
  const filename = TEMPLATE_FILES[phase];
  if (filename === undefined) {
    throw new PromptTemplateError(`Unknown phase: ${phase}`);
  }

  // Tier 1: per-repo custom directory
  if (customDir !== null) {
    const content = loadFromDir(customDir, filename, "untrusted");
    if (content !== null) {
      logger.info("Loaded template from custom directory: %s", customDir);
      return content;
    }
    logger.info(
      "Custom template not found in %s (falling back to user prompts)",
      customDir,
    );
  }

  // Tier 2: user common prompts (~/.sabori-flow/prompts/)
  const userContent = loadFromDir(userDir, filename, "untrusted");
  if (userContent !== null) {
    logger.info("Loaded template from user directory: %s", userDir);
    return userContent;
  }
  logger.info(
    "User template not found in %s (falling back to package default)",
    userDir,
  );

  // Tier 3: package-bundled default
  const defaultContent = loadFromDir(defaultDir, filename, "trusted");
  if (defaultContent !== null) {
    return defaultContent;
  }

  throw new PromptTemplateError(
    `Template file not found: ${filename}`,
  );
}

/**
 * テンプレートファイルパスがディレクトリ配下に収まっていることを検証する。
 *
 * シンボリックリンクやパストラバーサルにより、テンプレートファイルが
 * 指定ディレクトリの外に逸脱することを防止する。
 *
 * 呼び出し元がファイルの存在を確認済みであることを前提とする。
 *
 * @throws {PromptTemplateError} パスがディレクトリ外に逸脱している場合
 */
function validatePathContainment(
  filePath: string,
  dirPath: string,
): void {
  let resolvedFile: string;
  try {
    resolvedFile = realpathSync(filePath);
  } catch {
    throw new PromptTemplateError(
      `Cannot resolve template file path: ${basename(filePath)}`,
    );
  }

  let resolvedDir: string;
  try {
    resolvedDir = realpathSync(dirPath);
  } catch {
    throw new PromptTemplateError(
      `Cannot resolve template directory path: ${dirPath}`,
    );
  }

  // resolvedFile が resolvedDir 配下であることを確認
  const normalizedDir = resolvedDir.endsWith("/") ? resolvedDir : `${resolvedDir}/`;
  if (!resolvedFile.startsWith(normalizedDir)) {
    throw new PromptTemplateError(
      `Template file path escapes the prompts directory: ${basename(filePath)}`,
    );
  }
}

/**
 * カスタムテンプレートにバウンダリプレースホルダが含まれていることを検証する。
 *
 * バウンダリマーカーが欠落しているテンプレートは、Issue body 内の
 * 悪意あるテキストがプロンプトインジェクションとして解釈されるリスクがある。
 *
 * @throws {PromptTemplateError} 必須のバウンダリプレースホルダが欠落している場合
 */
function validateBoundaryPlaceholders(
  content: string,
  templatePath: string,
): void {
  const missing = REQUIRED_BOUNDARY_PLACEHOLDERS.filter(
    (placeholder) => !content.includes(placeholder),
  );

  if (missing.length > 0) {
    throw new PromptTemplateError(
      `Custom template '${basename(templatePath)}' is missing required boundary placeholders: ${missing.join(", ")}. ` +
      `These are required to prevent prompt injection attacks.`,
    );
  }

  // Check order: {boundary_open} must come before {issue_body} which must come before {boundary_close}
  if (content.includes("{issue_body}")) {
    const openIdx = content.indexOf("{boundary_open}");
    const bodyIdx = content.indexOf("{issue_body}");
    const closeIdx = content.indexOf("{boundary_close}");
    if (!(openIdx < bodyIdx && bodyIdx < closeIdx)) {
      throw new PromptTemplateError(
        `Custom template '${basename(templatePath)}': {issue_body} must appear ` +
        `between {boundary_open} and {boundary_close} for prompt injection protection.`,
      );
    }
  }
}

/**
 * テンプレートファイルを読み込む内部ヘルパー。
 *
 * レギュラーファイル判定とファイルサイズの上限チェックを行い、
 * 不正なファイルや巨大ファイルによる DoS を防止する。
 *
 * @throws {PromptTemplateError} ファイルの読み込みに失敗、レギュラーファイルでない、
 *   またはサイズ超過の場合
 */
function readTemplateFile(templatePath: string): string {
  try {
    const stat = statSync(templatePath);
    if (!stat.isFile()) {
      throw new PromptTemplateError(
        `Template path is not a regular file: ${basename(templatePath)}`,
      );
    }
    if (stat.size > MAX_TEMPLATE_SIZE) {
      throw new PromptTemplateError(
        `Template file too large: ${basename(templatePath)} (${stat.size} bytes, max ${MAX_TEMPLATE_SIZE} bytes)`,
      );
    }
    return readFileSync(templatePath, "utf-8");
  } catch (error: unknown) {
    if (error instanceof PromptTemplateError) throw error;
    throw new PromptTemplateError(
      `Failed to read template file: ${basename(templatePath)}`,
    );
  }
}

/**
 * ランダムバウンダリトークンを生成する。
 *
 * 固定タグ（例: `<issue-body>`）ではなく、予測不能なトークンを使うことで
 * 攻撃者がバウンダリを偽装するプロンプトインジェクションを困難にする。
 */
function generateBoundaryToken(): string {
  return randomUUID();
}

/**
 * Issue ボディからバウンダリ終了パターンを除去する。
 *
 * トークンが予測不能なため衝突はほぼ起きないが、
 * 防御的にバウンダリ終了マーカーと一致するパターンを除去する。
 */
function sanitizeBoundaryInBody(body: string, token: string): string {
  const closePattern = `<!-- BOUNDARY-${token} DATA END -->`;
  return body.replaceAll(closePattern, "");
}

/**
 * プレースホルダに対応する変数マップを構築する。
 */
function buildVariables(
  issue: Issue,
  repoConfig: RepositoryConfig,
): Map<string, string> {
  const token = generateBoundaryToken();
  const rawBody = issue.body ?? "";
  const sanitizedBody = sanitizeBoundaryInBody(rawBody, token);

  return new Map<string, string>([
    ["repo_full_name", repoFullName(repoConfig)],
    ["repo_owner", repoConfig.owner],
    ["repo_name", repoConfig.repo],
    ["issue_number", String(issue.number)],
    ["issue_title", issue.title],
    ["issue_url", issue.url],
    ["boundary_open", `<!-- BOUNDARY-${token} DATA START -->`],
    ["boundary_close", `<!-- BOUNDARY-${token} DATA END -->`],
    ["issue_body", sanitizedBody],
  ]);
}

/**
 * テンプレート内のプレースホルダを変数で展開する。
 *
 * 各プレースホルダ `{key}` を対応する値で置換する。
 * `String.replace()` の第2引数に関数を使用し、`$&` や `$'` 等の
 * 特殊パターン解釈を回避する。
 *
 * ユーザー入力由来の変数（`issue_body`, `issue_title`）は最後に展開する。
 * これにより、ユーザー入力に `{repo_full_name}` のようなプレースホルダ風
 * 文字列が含まれていた場合でも二重展開を防止できる。
 */
function render(template: string, variables: Map<string, string>): string {
  let result = template;

  const userInputVars = new Map<string, string>();

  for (const [key, value] of variables) {
    if (USER_INPUT_KEYS.has(key)) {
      userInputVars.set(key, value);
    } else {
      result = result.replaceAll(`{${key}}`, () => value);
    }
  }

  for (const [key, value] of userInputVars) {
    result = result.replaceAll(`{${key}}`, () => value);
  }

  return result;
}
