import type { IssueComment } from "./models.js";
import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import { createLogger } from "./logger.js";

const logger = createLogger("issue-comments");

const GH_TIMEOUT_MS = 120_000;

export const SPEC_COMMENT_FETCH_LIMIT = 50;

export class IssueCommentsError extends Error {
  readonly structural: boolean;

  constructor(message: string, structural: boolean) {
    super(message);
    Object.setPrototypeOf(this, IssueCommentsError.prototype);
    this.structural = structural;
  }
}

const GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      comments(last: ${SPEC_COMMENT_FETCH_LIMIT}) {
        nodes {
          body
          createdAt
          authorAssociation
          viewerDidAuthor
        }
      }
    }
  }
}
`;

/**
 * Issue の直近コメントを GraphQL API で取得する。
 *
 * @throws {IssueCommentsError} structural=false は一時的な失敗（次サイクルでリトライ）、
 *         structural=true は構造的な失敗（リトライしても直らない）
 */
export async function fetchIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<readonly IssueComment[]> {
  let stdout: string;
  try {
    const result = await runCommand(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=${GRAPHQL_QUERY}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `repo=${repo}`,
        "-F",
        `number=${issueNumber}`,
      ],
      { timeoutMs: GH_TIMEOUT_MS },
    );

    if (!result.success) {
      throw new IssueCommentsError(result.stderr, false);
    }
    stdout = result.stdout;
  } catch (error: unknown) {
    if (error instanceof IssueCommentsError) throw error;
    if (error instanceof ProcessTimeoutError) {
      throw new IssueCommentsError(
        `gh api graphql timed out after ${GH_TIMEOUT_MS / 1_000} seconds`,
        false,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new IssueCommentsError(error.message, false);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new IssueCommentsError(
      `Failed to parse GraphQL response: ${stdout.slice(0, 200)}`,
      true,
    );
  }

  const nodes = extractNodes(parsed);
  return nodes.map((node, i) => parseCommentNode(node, i));
}

function extractNodes(parsed: unknown): unknown[] {
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("data" in (parsed as Record<string, unknown>))
  ) {
    throw new IssueCommentsError(
      "GraphQL response missing 'data' field",
      true,
    );
  }

  const data = (parsed as Record<string, unknown>).data;
  const repo = (data as Record<string, unknown>)?.repository;
  const issue = (repo as Record<string, unknown>)?.issue;
  const comments = (issue as Record<string, unknown>)?.comments;
  const nodes = (comments as Record<string, unknown>)?.nodes;

  if (!Array.isArray(nodes)) {
    throw new IssueCommentsError(
      "GraphQL response missing comments.nodes array",
      true,
    );
  }

  return nodes;
}

function parseCommentNode(node: unknown, index: number): IssueComment {
  if (node === null || typeof node !== "object") {
    throw new IssueCommentsError(
      `Comment node[${index}] is not an object`,
      true,
    );
  }

  const record = node as Record<string, unknown>;

  if (typeof record.body !== "string") {
    throw new IssueCommentsError(
      `Comment node[${index}] missing 'body' field`,
      true,
    );
  }
  if (typeof record.createdAt !== "string") {
    throw new IssueCommentsError(
      `Comment node[${index}] missing 'createdAt' field`,
      true,
    );
  }
  if (typeof record.authorAssociation !== "string") {
    throw new IssueCommentsError(
      `Comment node[${index}] missing 'authorAssociation' field`,
      true,
    );
  }
  if (typeof record.viewerDidAuthor !== "boolean") {
    throw new IssueCommentsError(
      `Comment node[${index}] missing 'viewerDidAuthor' field`,
      true,
    );
  }

  return {
    body: record.body,
    createdAt: record.createdAt,
    authorAssociation: record.authorAssociation,
    viewerDidAuthor: record.viewerDidAuthor,
  };
}
