import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProcessTimeoutError,
  ProcessExecutionError,
} from "../../src/worker/process.js";

vi.mock("../../src/worker/process.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/worker/process.js")>();
  return {
    ...original,
    runCommand: vi.fn(),
  };
});

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  fetchIssueComments,
  IssueCommentsError,
  SPEC_COMMENT_FETCH_LIMIT,
} from "../../src/worker/issue-comments.js";
import { runCommand } from "../../src/worker/process.js";

const mockedRunCommand = vi.mocked(runCommand);

function makeGraphQLResponse(
  nodes: Array<{
    body: string;
    createdAt?: string;
    authorAssociation?: string;
    viewerDidAuthor?: boolean;
  }>,
): string {
  return JSON.stringify({
    data: {
      repository: {
        issue: {
          comments: {
            nodes: nodes.map((n) => ({
              body: n.body,
              createdAt: n.createdAt ?? "2025-01-01T00:00:00Z",
              authorAssociation: n.authorAssociation ?? "OWNER",
              viewerDidAuthor: n.viewerDidAuthor ?? false,
            })),
          },
        },
      },
    },
  });
}

describe("fetchIssueComments", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("SPEC_COMMENT_FETCH_LIMIT is 50", () => {
    expect(SPEC_COMMENT_FETCH_LIMIT).toBe(50);
  });

  it("GraphQL query selects body, createdAt, authorAssociation, viewerDidAuthor", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: makeGraphQLResponse([]),
      stderr: "",
    });

    await fetchIssueComments("owner", "repo", 42);

    const args = mockedRunCommand.mock.calls[0][1] as string[];
    const queryArg = args.find((a) => a.startsWith("query="));
    expect(queryArg).toBeDefined();
    const query = queryArg!.slice("query=".length);
    expect(query).toContain("body");
    expect(query).toContain("createdAt");
    expect(query).toContain("authorAssociation");
    expect(query).toContain("viewerDidAuthor");
    expect(query).toContain(`last: ${SPEC_COMMENT_FETCH_LIMIT}`);
  });

  it("parses valid response correctly", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: makeGraphQLResponse([
        {
          body: "hello",
          createdAt: "2025-06-01T00:00:00Z",
          authorAssociation: "OWNER",
          viewerDidAuthor: true,
        },
      ]),
      stderr: "",
    });

    const comments = await fetchIssueComments("owner", "repo", 42);

    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("hello");
    expect(comments[0].createdAt).toBe("2025-06-01T00:00:00Z");
    expect(comments[0].authorAssociation).toBe("OWNER");
    expect(comments[0].viewerDidAuthor).toBe(true);
  });

  it("gh non-zero exit throws transient IssueCommentsError", async () => {
    mockedRunCommand.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "HTTP 500",
    });

    const err = await fetchIssueComments("o", "r", 1).catch((e) => e);
    expect(err).toBeInstanceOf(IssueCommentsError);
    expect(err.structural).toBe(false);
  });

  it("timeout throws transient IssueCommentsError", async () => {
    mockedRunCommand.mockRejectedValue(new ProcessTimeoutError(120_000));

    const err = await fetchIssueComments("o", "r", 1).catch((e) => e);
    expect(err).toBeInstanceOf(IssueCommentsError);
    expect(err.structural).toBe(false);
  });

  it("ProcessExecutionError throws transient IssueCommentsError", async () => {
    mockedRunCommand.mockRejectedValue(
      new ProcessExecutionError("spawn gh ENOENT"),
    );

    const err = await fetchIssueComments("o", "r", 1).catch((e) => e);
    expect(err).toBeInstanceOf(IssueCommentsError);
    expect(err.structural).toBe(false);
  });

  it("JSON parse failure throws structural IssueCommentsError", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "not json",
      stderr: "",
    });

    const err = await fetchIssueComments("o", "r", 1).catch((e) => e);
    expect(err).toBeInstanceOf(IssueCommentsError);
    expect(err.structural).toBe(true);
  });

  it("missing viewerDidAuthor throws structural IssueCommentsError", async () => {
    const stdout = JSON.stringify({
      data: {
        repository: {
          issue: {
            comments: {
              nodes: [
                {
                  body: "hello",
                  createdAt: "2025-01-01T00:00:00Z",
                  authorAssociation: "OWNER",
                  // viewerDidAuthor intentionally omitted
                },
              ],
            },
          },
        },
      },
    });
    mockedRunCommand.mockResolvedValue({ success: true, stdout, stderr: "" });

    const err = await fetchIssueComments("o", "r", 1).catch((e) => e);
    expect(err).toBeInstanceOf(IssueCommentsError);
    expect(err.structural).toBe(true);
    expect(err.message).toContain("viewerDidAuthor");
  });

  it("missing data field throws structural IssueCommentsError", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: JSON.stringify({ errors: [{ message: "oops" }] }),
      stderr: "",
    });

    const err = await fetchIssueComments("o", "r", 1).catch((e) => e);
    expect(err).toBeInstanceOf(IssueCommentsError);
    expect(err.structural).toBe(true);
  });
});
