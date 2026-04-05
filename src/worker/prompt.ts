import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { Issue, RepositoryConfig } from "./models.js";
import { Phase, repoFullName } from "./models.js";
import { getDefaultPromptsDir } from "../utils/paths.js";
import { createLogger } from "./logger.js";

/** テンプレート関連のエラー */
export class PromptTemplateError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, PromptTemplateError.prototype);
  }
}

const logger = createLogger("prompt");

const TEMPLATE_FILES: Record<Phase, string> = {
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
 * `repoConfig.promptsDir` が指定されていればそちらを優先し、
 * ファイルが存在しなければパッケージ同梱のデフォルトテンプレートにフォールバックする。
 *
 * @throws {PromptTemplateError} テンプレートの読み込みまたは展開に失敗した場合
 */
export function buildPrompt(
  issue: Issue,
  repoConfig: RepositoryConfig,
): string {
  const customDir = repoConfig.promptsDir;
  const defaultDir = getDefaultPromptsDir();
  const template = loadTemplate(issue.phase, customDir, defaultDir);
  const variables = buildVariables(issue, repoConfig);
  return render(template, variables);
}

/**
 * テンプレートファイルを読み込む。
 *
 * カスタムプロンプトディレクトリが指定されている場合はそちらを優先し、
 * ファイルが存在しなければデフォルトディレクトリにフォールバックする。
 * ファイルが存在するが読み込めない場合はエラーとする（フォールバックしない）。
 *
 * カスタムテンプレートにはバウンダリプレースホルダの存在を検証し、
 * 欠落している場合はプロンプトインジェクション防止のためエラーとする。
 *
 * @throws {PromptTemplateError} フェーズが未定義、テンプレートが存在しない、
 *   バウンダリプレースホルダが欠落、またはファイルサイズ超過の場合
 */
function loadTemplate(
  phase: Phase,
  customDir: string | null,
  defaultDir: string,
): string {
  const filename = TEMPLATE_FILES[phase];
  if (filename === undefined) {
    throw new PromptTemplateError(`Unknown phase: ${phase}`);
  }

  // カスタムディレクトリからの読み込みを試行
  if (customDir !== null) {
    const customPath = resolve(customDir, filename);

    if (existsSync(customPath)) {
      validatePathContainment(customPath, customDir);
      const content = readTemplateFile(customPath);
      validateBoundaryPlaceholders(content, customPath);
      return content;
    }

    logger.info(
      "Custom template not found: %s (falling back to default)",
      customPath,
    );
  }

  // デフォルトディレクトリからの読み込み
  const defaultPath = resolve(defaultDir, filename);
  if (existsSync(defaultPath)) {
    return readTemplateFile(defaultPath);
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
