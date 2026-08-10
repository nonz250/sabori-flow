import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { Language } from "../i18n/types.js";
import type { Issue, RepositoryConfig } from "./models.js";
import { Phase, repoFullName } from "./models.js";
import { getUserPromptsLanguageDir, getDefaultPromptsDir } from "../utils/paths.js";
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
  [Phase.SPEC]: "spec.md",
  [Phase.PLAN]: "plan.md",
  [Phase.IMPL]: "impl.md",
};

/** テンプレートファイルの最大サイズ (100KB) */
const MAX_TEMPLATE_SIZE = 100 * 1024;

/**
 * ユーザー入力由来の変数キー。
 * 二重展開防止のため、これらは最後に展開する。
 */
const USER_INPUT_KEYS: ReadonlySet<string> = new Set([
  "issue_body",
  "issue_title",
  "spec",
]);

/**
 * Issue とリポジトリ設定からプロンプト文字列を組み立てる。
 *
 * テンプレートファイルを読み込み、プレースホルダを展開して返す。
 * 2 段階のフォールバックでテンプレートを解決する:
 *   1. ユーザーディレクトリ (`~/.sabori-flow/prompts/<language>/`)
 *   2. パッケージ同梱のデフォルトテンプレート (`prompts/<language>/`)
 *
 * @throws {PromptTemplateError} テンプレートの読み込みまたは展開に失敗した場合
 */
export function buildPrompt(
  issue: Issue,
  repoConfig: RepositoryConfig,
  language: Language,
  specContext: string | null = null,
): string {
  const userDir = getUserPromptsLanguageDir(language);
  const defaultDir = join(getDefaultPromptsDir(), language);
  const template = loadTemplate(issue.phase, userDir, defaultDir);
  const variables = buildVariables(issue, repoConfig, specContext);

  if (specContext !== null && !template.includes("{spec}")) {
    logger.warn(
      "Template for %s phase does not contain {spec} placeholder — spec context will be lost",
      issue.phase,
    );
  }

  return render(template, variables);
}

/**
 * 2 段階フォールバックでテンプレートファイルを読み込む。
 *
 *   1. ユーザーディレクトリ (`~/.sabori-flow/prompts/<language>/`)
 *   2. パッケージ同梱のデフォルトディレクトリ (`prompts/<language>/`)
 *
 * @throws {PromptTemplateError} フェーズが未定義、テンプレートが存在しない、
 *   またはファイルサイズ超過の場合
 */
function loadTemplate(
  phase: Phase,
  userDir: string,
  defaultDir: string,
): string {
  const filename = TEMPLATE_FILES[phase];
  if (filename === undefined) {
    throw new PromptTemplateError(`Unknown phase: ${phase}`);
  }

  // 1. ユーザーディレクトリ (~/.sabori-flow/prompts/<language>/)
  const userPath = resolve(userDir, filename);
  if (existsSync(userPath)) {
    logger.info("Loaded template from user directory: %s", userDir);
    return readTemplateFile(userPath);
  }
  logger.info(
    "User template not found in %s (falling back to package default)",
    userDir,
  );

  // 2. パッケージ同梱デフォルト
  const defaultPath = resolve(defaultDir, filename);
  if (existsSync(defaultPath)) {
    return readTemplateFile(defaultPath);
  }

  throw new PromptTemplateError(
    `Template file not found: ${filename}`,
  );
}

/**
 * テンプレートファイルを読み込む内部ヘルパー。
 *
 * レギュラーファイル判定とファイルサイズの上限チェックを行う。
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
  specContext: string | null,
): Map<string, string> {
  const token = generateBoundaryToken();
  const rawBody = issue.body ?? "";
  const sanitizedBody = sanitizeBoundaryInBody(rawBody, token);

  const specValue = specContext !== null
    ? sanitizeBoundaryInBody(specContext, token)
    : "(no specification has been agreed for this issue)";

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
    ["spec", specValue],
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

/**
 * Not surfaced in prompts/{lang}/impl.md: introducing this escape hatch
 * before work starts could make the model declare no-change prematurely.
 * It is offered only in IMPL_RESUME_PROMPTS, after the model has already
 * attempted the work. The marker is model output shaped by a
 * user-controlled Issue body, so it is not a trust boundary — the terminal
 * label for this outcome stays :failed (human gate) rather than :done, so
 * the marker can only affect the diagnostic comment's wording.
 */
export const IMPL_NO_CHANGE_MARKER = "SABORI_FLOW_NO_CHANGE_REQUIRED";

/**
 * Unlike the phase templates under prompts/{lang}/, this prompt stays in
 * code: it is part of the worker's recovery control flow rather than a task
 * instruction, so a user edit here could silently disable the recovery.
 */
export const IMPL_RESUME_PROMPTS: Record<Language, string> = {
  ja: `前回の応答でこのセッションは一度終了しました。この Issue に紐づく Pull Request はまだ存在しません。

作業ツリーの変更はそのまま残っていますが、前回起動したバックグラウンドプロセスやサブエージェントはセッション終了時に強制終了されており、その結果は残っていません。復元されるのは会話履歴だけです。

このセッションも非対話モードです。あなたが応答を返した時点で終了し、実行中のバックグラウンドプロセスは再び破棄されます。「完了を待ちます」と述べて応答を終えることはできません。リポジトリの CLAUDE.md 等に「長時間ジョブはバックグラウンドで起動して完了通知を待つ」旨の記述があっても、このセッションの終了タイミングについてはこの指示を優先してください。

次のいずれかを行ってください。

1. 作業が未完了の場合: 必要な検証をこのセッション内で実行し（前回の結果は残っていないため、必要ならやり直してください）、結果を確認したうえで Pull Request の作成まで終わらせてください。
2. Pull Request を作成済みの場合: 本文に対象 Issue のクローズキーワード（先の指示で示した \`close <Issue の URL>\` の形式）が含まれているか確認し、含まれていなければ本文を更新してください。
3. 実装を検討した結果、コード変更が不要だと結論した場合のみ: Pull Request を作成せず、その理由を説明したうえで、最終行に ${IMPL_NO_CHANGE_MARKER} とだけ書いた行を出力してください。

3 は「変更が本当に不要」な場合のためのものです。作業が残っている場合に使わないでください。`,
  en: `This session already ended with your previous response. No Pull Request is linked to this issue yet.

The working tree changes are still intact, but any background process or subagent you started before was force-terminated when that session ended, and its results are gone. Only the conversation history was restored.

This session also runs non-interactively. It will terminate the moment you return a response, and any background process still running will be discarded again. You cannot end your response by saying you will wait for something to complete. Even if the repository's CLAUDE.md or similar tells you to start long-running jobs in the background and wait for a completion notification, prioritize this instruction regarding when this session ends.

Do one of the following.

1. If the work is not yet complete: run whatever verification is needed within this session (previous results are gone, so redo them if necessary), confirm the result, and finish by creating the Pull Request.
2. If a Pull Request has already been created: check whether its body contains the closing keyword for the target issue (the \`close <issue URL>\` format shown earlier) and update the body if it does not.
3. Only if, after considering the implementation, you conclude that no code change is required: do not create a Pull Request; explain why, then output a final line containing only ${IMPL_NO_CHANGE_MARKER}.

Option 3 is only for cases where a change is genuinely unnecessary. Do not use it while work remains.`,
};
