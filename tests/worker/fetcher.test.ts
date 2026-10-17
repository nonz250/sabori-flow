import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/worker/process.js");

import {
  fetchIssues,
  fetchReviewPullRequests,
  fetchPullRequestDetails,
  GitHubCLIError,
  IssueParseError,
} from "../../src/worker/fetcher.js";
import { runCommand } from "../../src/worker/process.js";
import {
  ProcessTimeoutError,
  ProcessExecutionError,
} from "../../src/worker/process.js";
import { Phase, Priority } from "../../src/worker/models.js";
import type { RepositoryConfig, Issue } from "../../src/worker/models.js";

const mockedRunCommand = vi.mocked(runCommand);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoConfig(): RepositoryConfig {
  return {
    owner: "nonz250",
    repo: "example-app",
    localPath: "/tmp/nonz250/example-app",
    labels: {
      spec: {
        trigger: "test/spec",
        inProgress: "test/spec/in-progress",
        done: "test/spec/done",
        failed: "test/spec/failed",
        review: "test/spec/review",
        approved: "test/spec/approved",
        needsHuman: "test/spec/needs-human",
      },
      plan: {
        trigger: "test/plan",
        inProgress: "test/plan/in-progress",
        done: "test/plan/done",
        failed: "test/plan/failed",
      },
      impl: {
        trigger: "test/impl",
        inProgress: "test/impl/in-progress",
        done: "test/impl/done",
        failed: "test/impl/failed",
      },
    },
    priorityLabels: ["priority:high", "priority:low"],
  };
}

function makeGhJson(issues: object[]): string {
  return JSON.stringify(issues);
}

function mockGhSuccess(stdout: string): void {
  mockedRunCommand.mockResolvedValue({
    success: true,
    stdout,
    stderr: "",
  });
}

function mockGhFailure(stderr: string): void {
  mockedRunCommand.mockResolvedValue({
    success: false,
    stdout: "",
    stderr,
  });
}

// ---------------------------------------------------------------------------
// fetchIssues テスト
// ---------------------------------------------------------------------------

describe("fetchIssues", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("gh コマンドに正しい引数が渡される", async () => {
    mockGhSuccess("[]");

    await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "api",
        "repos/nonz250/example-app/issues",
        "--method",
        "GET",
        "--field",
        "labels=test/plan",
        "--field",
        "state=open",
        "--field",
        "per_page=100",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("plan フェーズでは plan の trigger ラベルが使われる", async () => {
    mockGhSuccess("[]");

    await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    const callArgs = mockedRunCommand.mock.calls[0][1];
    expect(callArgs).toContain("labels=test/plan");
  });

  it("impl フェーズでは impl の trigger ラベルが使われる", async () => {
    mockGhSuccess("[]");

    await fetchIssues(makeRepoConfig(), Phase.IMPL, "test/impl");

    const callArgs = mockedRunCommand.mock.calls[0][1];
    expect(callArgs).toContain("labels=test/impl");
  });

  it("パースとソートが正しく行われる", async () => {
    const rawJson = makeGhJson([
      {
        number: 5,
        title: "Low priority",
        body: "body",
        labels: [{ name: "test/plan" }, { name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/5",
        author_association: "OWNER",
      },
      {
        number: 3,
        title: "High priority",
        body: "body",
        labels: [{ name: "test/plan" }, { name: "priority:high" }],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "COLLABORATOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const result = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(result).toHaveLength(2);
    expect(result[0].number).toBe(3);
    expect(result[0].priority).toBe(Priority.HIGH);
    expect(result[1].number).toBe(5);
    expect(result[1].priority).toBe(Priority.LOW);
  });

  it("gh コマンドが失敗した場合 GitHubCLIError が throw される", async () => {
    mockGhFailure("gh: not found");

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(GitHubCLIError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("gh: not found");
  });

  it("タイムアウト時に GitHubCLIError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(
      new ProcessTimeoutError(120_000),
    );

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(GitHubCLIError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("gh command timed out after 120 seconds");
  });

  it("ProcessExecutionError が GitHubCLIError にラップされる", async () => {
    const execError = Object.assign(new Error("spawn gh ENOENT"), {
      name: "ProcessExecutionError",
    });
    Object.setPrototypeOf(execError, ProcessExecutionError.prototype);
    mockedRunCommand.mockRejectedValue(execError);

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(GitHubCLIError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("spawn gh ENOENT");
  });
});

// ---------------------------------------------------------------------------
// parseIssues 相当のテスト（fetchIssues 経由で検証）
// ---------------------------------------------------------------------------

describe("fetchIssues - JSON パース", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("正しい JSON をパースして Issue を返す", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "First issue",
        body: "Body text",
        labels: [{ name: "test/plan" }, { name: "priority:high" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(1);
    const issue = issues[0];
    expect(issue.number).toBe(1);
    expect(issue.title).toBe("First issue");
    expect(issue.body).toBe("Body text");
    expect(issue.labels).toEqual(["test/plan", "priority:high"]);
    expect(issue.url).toBe(
      "https://github.com/nonz250/example-app/issues/1",
    );
    expect(issue.authorAssociation).toBe("OWNER");
    expect(issue.phase).toBe(Phase.PLAN);
    expect(issue.priority).toBe(Priority.HIGH);
  });

  it("labels が dict のリストから name のリストに変換される", async () => {
    const rawJson = makeGhJson([
      {
        number: 2,
        title: "Label test",
        body: "body",
        labels: [
          { name: "bug" },
          { name: "enhancement" },
          { name: "priority:low" },
        ],
        html_url: "https://github.com/nonz250/example-app/issues/2",
        author_association: "MEMBER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.IMPL, "test/impl");

    expect(issues[0].labels).toEqual(["bug", "enhancement", "priority:low"]);
  });

  it("body が null の場合 null のまま保持される", async () => {
    const rawJson = makeGhJson([
      {
        number: 3,
        title: "No body",
        body: null,
        labels: [],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues[0].body).toBeNull();
  });

  it("不正な JSON の場合 IssueParseError が throw される", async () => {
    mockGhSuccess("not valid json");

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("Failed to parse JSON");
  });

  it("空の JSON 配列は空リストを返す", async () => {
    mockGhSuccess("[]");

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toEqual([]);
  });

  it("number が欠落している場合 IssueParseError が throw される", async () => {
    const rawJson = makeGhJson([
      {
        title: "No number",
        body: "body",
        labels: [],
        html_url: "https://github.com/nonz250/example-app/issues/1",
      },
    ]);
    mockGhSuccess(rawJson);

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("Missing required field");
  });

  it("title が欠落している場合 IssueParseError が throw される", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        body: "body",
        labels: [],
        html_url: "https://github.com/nonz250/example-app/issues/1",
      },
    ]);
    mockGhSuccess(rawJson);

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("Missing required field");
  });

  it("url が欠落している場合 IssueParseError が throw される", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "No url",
        body: "body",
        labels: [],
      },
    ]);
    mockGhSuccess(rawJson);

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan"),
    ).rejects.toThrow("Missing required field");
  });
});

// ---------------------------------------------------------------------------
// 優先度判定テスト（fetchIssues 経由で検証）
// ---------------------------------------------------------------------------

describe("fetchIssues - 優先度判定", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("priority:high ラベルがあれば HIGH になる", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Issue",
        body: "body",
        labels: [{ name: "bug" }, { name: "priority:high" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues[0].priority).toBe(Priority.HIGH);
  });

  it("priority:low ラベルがあれば LOW になる", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Issue",
        body: "body",
        labels: [{ name: "bug" }, { name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues[0].priority).toBe(Priority.LOW);
  });

  it("優先度ラベルがなければ NONE になる", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Issue",
        body: "body",
        labels: [{ name: "bug" }, { name: "enhancement" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues[0].priority).toBe(Priority.NONE);
  });

  it("HIGH と LOW の両方がある場合 HIGH が優先される", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Issue",
        body: "body",
        labels: [{ name: "priority:high" }, { name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues[0].priority).toBe(Priority.HIGH);
  });
});

// ---------------------------------------------------------------------------
// ソートテスト（fetchIssues 経由で検証）
// ---------------------------------------------------------------------------

describe("fetchIssues - ソート", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("優先度順にソートされ、同じ優先度は number 昇順", async () => {
    const rawJson = makeGhJson([
      {
        number: 10,
        title: "None",
        body: null,
        labels: [],
        html_url: "https://github.com/nonz250/example-app/issues/10",
        author_association: "OWNER",
      },
      {
        number: 1,
        title: "Low",
        body: null,
        labels: [{ name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "MEMBER",
      },
      {
        number: 5,
        title: "High",
        body: null,
        labels: [{ name: "priority:high" }],
        html_url: "https://github.com/nonz250/example-app/issues/5",
        author_association: "COLLABORATOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const result = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(result[0].number).toBe(5);
    expect(result[0].priority).toBe(Priority.HIGH);
    expect(result[1].number).toBe(1);
    expect(result[1].priority).toBe(Priority.LOW);
    expect(result[2].number).toBe(10);
    expect(result[2].priority).toBe(Priority.NONE);
  });

  it("同じ優先度の Issue は number 昇順でソートされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 30,
        title: "Issue 30",
        body: null,
        labels: [{ name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/30",
        author_association: "OWNER",
      },
      {
        number: 10,
        title: "Issue 10",
        body: null,
        labels: [{ name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/10",
        author_association: "OWNER",
      },
      {
        number: 20,
        title: "Issue 20",
        body: null,
        labels: [{ name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/20",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const result = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(result.map((i) => i.number)).toEqual([10, 20, 30]);
  });
});

// ---------------------------------------------------------------------------
// authorAssociation フィルタリングテスト（fetchIssues 経由で検証）
// ---------------------------------------------------------------------------

describe("fetchIssues - authorAssociation フィルタリング", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("OWNER の Issue は処理対象に含まれる", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Owner issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("MEMBER の Issue は処理対象に含まれる", async () => {
    const rawJson = makeGhJson([
      {
        number: 2,
        title: "Member issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/2",
        author_association: "MEMBER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(2);
  });

  it("COLLABORATOR の Issue は処理対象に含まれる", async () => {
    const rawJson = makeGhJson([
      {
        number: 3,
        title: "Collaborator issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "COLLABORATOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(3);
  });

  it("NONE の Issue はフィルタリングされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 10,
        title: "External issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/10",
        author_association: "NONE",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(0);
  });

  it("FIRST_TIME_CONTRIBUTOR の Issue はフィルタリングされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 11,
        title: "First timer issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/11",
        author_association: "FIRST_TIME_CONTRIBUTOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(0);
  });

  it("許可された Issue と許可されない Issue が混在する場合、許可された Issue のみ返される", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Owner issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
      {
        number: 2,
        title: "External issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/2",
        author_association: "NONE",
      },
      {
        number: 3,
        title: "Member issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "MEMBER",
      },
      {
        number: 4,
        title: "Contributor issue",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/4",
        author_association: "CONTRIBUTOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
  });

  it("authorAssociation が未定義の場合フィルタリングされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 20,
        title: "No association",
        body: "body",
        labels: [{ name: "test/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/20",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN, "test/plan");

    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// fetchReviewPullRequests
// ---------------------------------------------------------------------------

function makePullRequestItem(overrides: Record<string, unknown> = {}): object {
  return {
    number: 7,
    title: "Add login form",
    body: "Adds the login form.",
    labels: [{ name: "ai/review" }],
    html_url: "https://github.com/nonz250/example-app/pull/7",
    author_association: "MEMBER",
    pull_request: { url: "https://api.github.com/repos/nonz250/example-app/pulls/7" },
    ...overrides,
  };
}

describe("fetchReviewPullRequests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("queries open issues carrying the review label", async () => {
    mockGhSuccess("[]");

    await fetchReviewPullRequests(makeRepoConfig(), "ai/review");

    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "api",
        "repos/nonz250/example-app/issues",
        "--method",
        "GET",
        "--field",
        "labels=ai/review",
        "--field",
        "state=open",
        "--field",
        "per_page=100",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("maps a pull request item", async () => {
    mockGhSuccess(makeGhJson([makePullRequestItem()]));

    const result = await fetchReviewPullRequests(makeRepoConfig(), "ai/review");

    expect(result).toEqual([
      {
        number: 7,
        title: "Add login form",
        body: "Adds the login form.",
        labels: ["ai/review"],
        url: "https://github.com/nonz250/example-app/pull/7",
        authorAssociation: "MEMBER",
      },
    ]);
  });

  it("drops plain issues that carry the review label", async () => {
    const issue = makePullRequestItem({ number: 3 }) as Record<string, unknown>;
    delete issue["pull_request"];
    mockGhSuccess(makeGhJson([issue, makePullRequestItem({ number: 8 })]));

    const result = await fetchReviewPullRequests(makeRepoConfig(), "ai/review");

    expect(result.map((pr) => pr.number)).toEqual([8]);
  });

  it("drops pull requests from authors without write access", async () => {
    mockGhSuccess(makeGhJson([
      makePullRequestItem({ number: 1, author_association: "CONTRIBUTOR" }),
      makePullRequestItem({ number: 2, author_association: "NONE" }),
      makePullRequestItem({ number: 3, author_association: "OWNER" }),
      makePullRequestItem({ number: 4, author_association: "COLLABORATOR" }),
    ]));

    const result = await fetchReviewPullRequests(makeRepoConfig(), "ai/review");

    expect(result.map((pr) => pr.number)).toEqual([3, 4]);
  });

  it("sorts by pull request number ascending", async () => {
    mockGhSuccess(makeGhJson([
      makePullRequestItem({ number: 12 }),
      makePullRequestItem({ number: 5 }),
    ]));

    const result = await fetchReviewPullRequests(makeRepoConfig(), "ai/review");

    expect(result.map((pr) => pr.number)).toEqual([5, 12]);
  });

  it("converts a missing body to null", async () => {
    const item = makePullRequestItem() as Record<string, unknown>;
    delete item["body"];
    mockGhSuccess(makeGhJson([item]));

    const result = await fetchReviewPullRequests(makeRepoConfig(), "ai/review");

    expect(result[0].body).toBeNull();
  });

  it("throws IssueParseError when a required field is missing", async () => {
    const item = makePullRequestItem() as Record<string, unknown>;
    delete item["html_url"];
    mockGhSuccess(makeGhJson([item]));

    await expect(fetchReviewPullRequests(makeRepoConfig(), "ai/review")).rejects.toThrow(
      IssueParseError,
    );
  });

  it("throws IssueParseError on invalid JSON", async () => {
    mockGhSuccess("not json");

    await expect(fetchReviewPullRequests(makeRepoConfig(), "ai/review")).rejects.toThrow(
      IssueParseError,
    );
  });

  it("throws GitHubCLIError when gh fails", async () => {
    mockGhFailure("HTTP 502");

    await expect(fetchReviewPullRequests(makeRepoConfig(), "ai/review")).rejects.toThrow(
      GitHubCLIError,
    );
  });
});

// ---------------------------------------------------------------------------
// fetchPullRequestDetails
// ---------------------------------------------------------------------------

describe("fetchPullRequestDetails", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the base branch and whether the head is in another repository", async () => {
    mockGhSuccess(JSON.stringify({ baseRefName: "develop", isCrossRepository: false }));

    const result = await fetchPullRequestDetails("nonz250/example-app", 7);

    expect(result).toEqual({ baseRefName: "develop", isCrossRepository: false });
    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "7", "--repo", "nonz250/example-app", "--json", "baseRefName,isCrossRepository"],
      { timeoutMs: 120_000 },
    );
  });

  it("throws IssueParseError when baseRefName is not a non-empty string", async () => {
    mockGhSuccess(JSON.stringify({ baseRefName: "", isCrossRepository: false }));

    await expect(fetchPullRequestDetails("nonz250/example-app", 7)).rejects.toThrow(
      IssueParseError,
    );
  });

  it("throws IssueParseError when isCrossRepository is not a boolean", async () => {
    mockGhSuccess(JSON.stringify({ baseRefName: "main" }));

    await expect(fetchPullRequestDetails("nonz250/example-app", 7)).rejects.toThrow(
      IssueParseError,
    );
  });

  it("throws IssueParseError on invalid JSON", async () => {
    mockGhSuccess("{");

    await expect(fetchPullRequestDetails("nonz250/example-app", 7)).rejects.toThrow(
      IssueParseError,
    );
  });

  it("throws GitHubCLIError when gh fails", async () => {
    mockGhFailure("not found");

    await expect(fetchPullRequestDetails("nonz250/example-app", 7)).rejects.toThrow(
      GitHubCLIError,
    );
  });
});
