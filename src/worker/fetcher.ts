import type { Issue, PullRequest, PullRequestDetails, RepositoryConfig } from "./models.js";
import { Phase, Priority, PERMITTED_ASSOCIATIONS, repoFullName } from "./models.js";
import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import { createLogger } from "./logger.js";

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

/** How much of the unparsable JSON to quote in the error message */
const JSON_ERROR_PREVIEW_LENGTH = 200;

const logger = createLogger("fetcher");


/** GitHub REST API の Issue レスポンス内の label 構造 */
interface GhLabel {
  readonly name: string;
}

/** GitHub REST API の Issue レスポンス内の 1 Issue 構造 */
interface GhIssueItem {
  readonly number?: number;
  readonly title?: string;
  readonly body?: string | null;
  readonly labels?: readonly GhLabel[];
  readonly html_url?: string;
  readonly author_association?: string;
  readonly pull_request?: unknown;
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
  label: string,
): Promise<readonly Issue[]> {
  const rawJson = await runGhCommand(buildOpenIssuesArgs(repoConfig, label));
  const issues = parseIssues(rawJson, phase, repoConfig);
  const permitted = filterByAuthorAssociation(issues, "Issue");
  return sortByPriority(permitted);
}

/**
 * Fetched from the issues REST endpoint and filtered down to pull requests,
 * because the JSON of `gh pr list` has no authorAssociation.
 *
 * @throws {GitHubCLIError} when the gh command fails
 * @throws {IssueParseError} when the JSON cannot be parsed
 */
export async function fetchReviewPullRequests(
  repoConfig: RepositoryConfig,
  label: string,
): Promise<readonly PullRequest[]> {
  const rawJson = await runGhCommand(buildOpenIssuesArgs(repoConfig, label));
  const permitted = filterByAuthorAssociation(parsePullRequests(rawJson), "PR");
  return [...permitted].sort((a, b) => a.number - b.number);
}

/**
 * @throws {GitHubCLIError} when the gh command fails
 * @throws {IssueParseError} when the JSON cannot be parsed
 */
export async function fetchPullRequestDetails(
  repoFullName: string,
  prNumber: number,
): Promise<PullRequestDetails> {
  const rawJson = await runGhCommand([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    repoFullName,
    "--json",
    "baseRefName,isCrossRepository",
  ]);

  let data: { baseRefName?: unknown; isCrossRepository?: unknown };
  try {
    data = JSON.parse(rawJson) as typeof data;
  } catch {
    throw new IssueParseError(`Failed to parse JSON: ${rawJson.slice(0, JSON_ERROR_PREVIEW_LENGTH)}`);
  }
  if (typeof data.baseRefName !== "string" || data.baseRefName === "") {
    throw new IssueParseError("Missing required field in pull request data: baseRefName");
  }
  if (typeof data.isCrossRepository !== "boolean") {
    throw new IssueParseError("Missing required field in pull request data: isCrossRepository");
  }
  return { baseRefName: data.baseRefName, isCrossRepository: data.isCrossRepository };
}

/** Serves both issues and pull requests, because the issues API returns pull requests too */
function buildOpenIssuesArgs(repoConfig: RepositoryConfig, label: string): string[] {
  return [
    "api",
    `repos/${repoFullName(repoConfig)}/issues`,
    "--method",
    "GET",
    "--field",
    `labels=${label}`,
    "--field",
    "state=open",
    "--field",
    "per_page=100",
  ];
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
    throw new IssueParseError(`Failed to parse JSON: ${rawJson.slice(0, JSON_ERROR_PREVIEW_LENGTH)}`);
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
    if (item.html_url === undefined) {
      throw new IssueParseError("Missing required field in issue data: html_url");
    }

    return {
      number: item.number,
      title: item.title,
      body: item.body ?? null,
      labels,
      url: item.html_url,
      authorAssociation: item.author_association ?? "",
      phase,
      priority,
    };
  });
}

/**
 * @throws {IssueParseError} when the JSON cannot be parsed
 */
function parsePullRequests(rawJson: string): PullRequest[] {
  let data: GhIssueItem[];
  try {
    data = JSON.parse(rawJson) as GhIssueItem[];
  } catch {
    throw new IssueParseError(`Failed to parse JSON: ${rawJson.slice(0, JSON_ERROR_PREVIEW_LENGTH)}`);
  }

  return data
    .filter((item) => item.pull_request !== undefined)
    .map((item) => {
      if (item.number === undefined) {
        throw new IssueParseError("Missing required field in pull request data: number");
      }
      if (item.title === undefined) {
        throw new IssueParseError("Missing required field in pull request data: title");
      }
      if (item.html_url === undefined) {
        throw new IssueParseError("Missing required field in pull request data: html_url");
      }

      return {
        number: item.number,
        title: item.title,
        body: item.body ?? null,
        labels: (item.labels ?? []).map((label) => label.name),
        url: item.html_url,
        authorAssociation: item.author_association ?? "",
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
 * Each excluded item is logged as a warning.
 */
function filterByAuthorAssociation<T extends { readonly number: number; readonly authorAssociation: string }>(
  items: readonly T[],
  kind: "Issue" | "PR",
): T[] {
  return items.filter((item) => {
    if (PERMITTED_ASSOCIATIONS.has(item.authorAssociation)) {
      return true;
    }
    logger.warn(
      "%s #%s skipped: author association '%s' is not permitted",
      kind,
      item.number,
      item.authorAssociation,
    );
    return false;
  });
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
