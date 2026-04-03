import type { Issue, RepositoryConfig } from "./models.js";
import { Phase, Priority, repoFullName } from "./models.js";
import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";

/** gh コマンドの実行エラー */
export class GitHubCLIError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, GitHubCLIError.prototype);
  }
}

/** Issue の JSON パースエラー */
export class IssueParseError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, IssueParseError.prototype);
  }
}

const GH_TIMEOUT_MS = 120_000;

/** gh issue list の JSON レスポンス内の label 構造 */
interface GhLabel {
  readonly name: string;
}

/** gh issue list の JSON レスポンス内の 1 Issue 構造 */
interface GhIssueItem {
  readonly number?: number;
  readonly title?: string;
  readonly body?: string | null;
  readonly labels?: readonly GhLabel[];
  readonly url?: string;
}

/**
 * 指定リポジトリ・フェーズの Issue を取得し、優先度順にソートして返す。
 *
 * @throws {GitHubCLIError} gh コマンドの実行に失敗した場合
 * @throws {IssueParseError} JSON のパースに失敗した場合
 */
export async function fetchIssues(
  repoConfig: RepositoryConfig,
  phase: Phase,
): Promise<readonly Issue[]> {
  const triggerLabel =
    phase === Phase.PLAN
      ? repoConfig.labels.plan.trigger
      : repoConfig.labels.impl.trigger;

  const args = [
    "issue",
    "list",
    "--repo",
    repoFullName(repoConfig),
    "--label",
    triggerLabel,
    "--state",
    "open",
    "--json",
    "number,title,body,labels,url",
    "--limit",
    "100",
  ];

  const rawJson = await runGhCommand(args);
  const issues = parseIssues(rawJson, phase, repoConfig);
  return sortByPriority(issues);
}

/**
 * gh コマンドを実行し、stdout を返す。
 *
 * @throws {GitHubCLIError} コマンドの終了コードが 0 でない場合、またはタイムアウト時
 */
async function runGhCommand(args: readonly string[]): Promise<string> {
  try {
    const result = await runCommand("gh", args, { timeoutMs: GH_TIMEOUT_MS });

    if (!result.success) {
      throw new GitHubCLIError(result.stderr);
    }

    return result.stdout;
  } catch (error: unknown) {
    if (error instanceof GitHubCLIError) {
      throw error;
    }
    if (error instanceof ProcessTimeoutError) {
      throw new GitHubCLIError(
        `gh command timed out after ${GH_TIMEOUT_MS / 1_000} seconds`,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new GitHubCLIError(error.message);
    }
    throw error;
  }
}

/**
 * JSON 文字列から Issue リストを生成する。
 *
 * @throws {IssueParseError} JSON のパースに失敗した場合
 */
function parseIssues(
  rawJson: string,
  phase: Phase,
  repoConfig: RepositoryConfig,
): Issue[] {
  let data: GhIssueItem[];
  try {
    data = JSON.parse(rawJson) as GhIssueItem[];
  } catch {
    throw new IssueParseError(`Failed to parse JSON: ${rawJson.slice(0, 200)}`);
  }

  return data.map((item) => {
    const labels = (item.labels ?? []).map((label) => label.name);
    const priority = determinePriority(labels, repoConfig.priorityLabels);

    if (item.number === undefined) {
      throw new IssueParseError("Missing required field in issue data: number");
    }
    if (item.title === undefined) {
      throw new IssueParseError("Missing required field in issue data: title");
    }
    if (item.url === undefined) {
      throw new IssueParseError("Missing required field in issue data: url");
    }

    return {
      number: item.number,
      title: item.title,
      body: item.body ?? null,
      labels,
      url: item.url,
      phase,
      priority,
    };
  });
}

/**
 * ラベルから優先度を判定する。
 *
 * priorityLabels のインデックスで判定:
 *   - index 0 のラベルが含まれる -> Priority.HIGH
 *   - index 1 のラベルが含まれる -> Priority.LOW
 *   - どちらも含まれない -> Priority.NONE
 *
 * 複数マッチ時は最も優先度が高いもの（インデックスが小さい方）を採用する。
 */
function determinePriority(
  labels: readonly string[],
  priorityLabels: readonly string[],
): Priority {
  const priorityMap: Record<number, Priority> = {
    0: Priority.HIGH,
    1: Priority.LOW,
  };

  for (let index = 0; index < priorityLabels.length; index++) {
    if (labels.includes(priorityLabels[index]) && index in priorityMap) {
      return priorityMap[index];
    }
  }

  return Priority.NONE;
}

/**
 * Issue を優先度順にソートする。
 *
 * ソートキー: (priority, number) の昇順
 */
function sortByPriority(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.number - b.number;
  });
}
