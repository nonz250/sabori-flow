import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { Issue, RepositoryConfig } from "./models.js";
import { Phase, repoFullName } from "./models.js";
import { getDefaultPromptsDir } from "../utils/paths.js";

/** テンプレート関連のエラー */
export class PromptTemplateError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, PromptTemplateError.prototype);
  }
}

const TEMPLATE_FILES: Record<Phase, string> = {
  [Phase.PLAN]: "plan.md",
  [Phase.IMPL]: "impl.md",
};

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
 * ユーザーカスタムプロンプトが存在すればそちらを優先し、
 * 存在しなければパッケージ同梱のデフォルトテンプレートにフォールバックする。
 *
 * @throws {PromptTemplateError} テンプレートの読み込みまたは展開に失敗した場合
 */
export function buildPrompt(
  issue: Issue,
  repoConfig: RepositoryConfig,
  promptsDir: string = getDefaultPromptsDir(),
): string {
  const template = loadTemplate(issue.phase, promptsDir);
  const variables = buildVariables(issue, repoConfig);
  return render(template, variables);
}

/**
 * テンプレートファイルを読み込む。
 *
 * パッケージ同梱のプロンプトディレクトリからのみ読み込む。
 * ユーザーカスタムプロンプトは将来的にセキュアな設計で提供予定（Issue #22）。
 *
 * @throws {PromptTemplateError} フェーズが未定義またはテンプレートが存在しない場合
 */
function loadTemplate(
  phase: Phase,
  promptsDir: string,
): string {
  const filename = TEMPLATE_FILES[phase];
  if (filename === undefined) {
    throw new PromptTemplateError(`Unknown phase: ${phase}`);
  }

  const templatePath = resolve(promptsDir, filename);
  if (existsSync(templatePath)) {
    return readTemplateFile(templatePath);
  }

  throw new PromptTemplateError(
    `Template file not found: ${filename}`,
  );
}

/**
 * テンプレートファイルを読み込む内部ヘルパー。
 *
 * @throws {PromptTemplateError} ファイルの読み込みに失敗した場合
 */
function readTemplateFile(templatePath: string): string {
  try {
    return readFileSync(templatePath, "utf-8");
  } catch {
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
