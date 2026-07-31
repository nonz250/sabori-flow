import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";

const GH_TIMEOUT_MS = 120_000;

/**
 * Delay before the single re-query issued when the first lookup finds no
 * linked pull request. GitHub's GraphQL read replica can briefly lag behind a
 * pull request created seconds earlier, and a false negative here costs a
 * human the trigger label re-apply.
 */
export const EMPTY_RESULT_RETRY_DELAY_MS = 5_000;

export class LinkedPullRequestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, LinkedPullRequestError.prototype);
  }
}

interface GhLinkedPullRequests {
  readonly closedByPullRequestsReferences: readonly { readonly number: number }[];
}

/**
 * Return the PR numbers linked to close the given issue.
 *
 * Uses `gh issue view --json closedByPullRequestsReferences` rather than
 * `gh pr list --search` because the former reads the GraphQL-native
 * association directly, avoiding search-index lag and catching draft /
 * open PRs immediately.
 *
 * @throws {LinkedPullRequestError} gh non-zero exit, timeout, or parse failure
 */
export async function fetchLinkedPullRequestNumbers(
  repoFullName: string,
  issueNumber: number,
): Promise<readonly number[]> {
  const first = await queryLinkedPullRequestNumbers(repoFullName, issueNumber);
  if (first.length > 0) {
    return first;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, EMPTY_RESULT_RETRY_DELAY_MS),
  );
  return queryLinkedPullRequestNumbers(repoFullName, issueNumber);
}

async function queryLinkedPullRequestNumbers(
  repoFullName: string,
  issueNumber: number,
): Promise<readonly number[]> {
  try {
    const result = await runCommand(
      "gh",
      [
        "issue",
        "view",
        String(issueNumber),
        "--repo",
        repoFullName,
        "--json",
        "closedByPullRequestsReferences",
      ],
      { timeoutMs: GH_TIMEOUT_MS },
    );
    if (!result.success) {
      throw new LinkedPullRequestError(result.stderr);
    }
    return parseLinkedPullRequestNumbers(result.stdout);
  } catch (error: unknown) {
    if (error instanceof LinkedPullRequestError) {
      throw error;
    }
    if (error instanceof ProcessTimeoutError) {
      throw new LinkedPullRequestError(
        `gh issue view timed out after ${GH_TIMEOUT_MS / 1_000} seconds`,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new LinkedPullRequestError(error.message);
    }
    throw error;
  }
}

function parseLinkedPullRequestNumbers(rawJson: string): readonly number[] {
  try {
    const parsed = JSON.parse(rawJson) as GhLinkedPullRequests;
    const refs = parsed.closedByPullRequestsReferences;
    if (!Array.isArray(refs)) {
      throw new TypeError("closedByPullRequestsReferences is not an array");
    }
    return refs.map((ref) => ref.number);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LinkedPullRequestError(
      `Failed to parse gh issue view output (${detail}): ${rawJson.slice(0, 200)}`,
    );
  }
}
