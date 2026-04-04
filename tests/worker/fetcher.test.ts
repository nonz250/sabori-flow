import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/worker/process.js");

import {
  fetchIssues,
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
      plan: {
        trigger: "claude/plan",
        inProgress: "claude/plan:in-progress",
        done: "claude/plan:done",
        failed: "claude/plan:failed",
      },
      impl: {
        trigger: "claude/impl",
        inProgress: "claude/impl:in-progress",
        done: "claude/impl:done",
        failed: "claude/impl:failed",
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

    await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "api",
        "repos/nonz250/example-app/issues",
        "--method",
        "GET",
        "--field",
        "labels=claude/plan",
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

    await fetchIssues(makeRepoConfig(), Phase.PLAN);

    const callArgs = mockedRunCommand.mock.calls[0][1];
    expect(callArgs).toContain("labels=claude/plan");
  });

  it("impl フェーズでは impl の trigger ラベルが使われる", async () => {
    mockGhSuccess("[]");

    await fetchIssues(makeRepoConfig(), Phase.IMPL);

    const callArgs = mockedRunCommand.mock.calls[0][1];
    expect(callArgs).toContain("labels=claude/impl");
  });

  it("パースとソートが正しく行われる", async () => {
    const rawJson = makeGhJson([
      {
        number: 5,
        title: "Low priority",
        body: "body",
        labels: [{ name: "claude/plan" }, { name: "priority:low" }],
        html_url: "https://github.com/nonz250/example-app/issues/5",
        author_association: "OWNER",
      },
      {
        number: 3,
        title: "High priority",
        body: "body",
        labels: [{ name: "claude/plan" }, { name: "priority:high" }],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "COLLABORATOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const result = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(result).toHaveLength(2);
    expect(result[0].number).toBe(3);
    expect(result[0].priority).toBe(Priority.HIGH);
    expect(result[1].number).toBe(5);
    expect(result[1].priority).toBe(Priority.LOW);
  });

  it("gh コマンドが失敗した場合 GitHubCLIError が throw される", async () => {
    mockGhFailure("gh: not found");

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(GitHubCLIError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow("gh: not found");
  });

  it("タイムアウト時に GitHubCLIError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(
      new ProcessTimeoutError(120_000),
    );

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(GitHubCLIError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow("gh command timed out after 120 seconds");
  });

  it("ProcessExecutionError が GitHubCLIError にラップされる", async () => {
    const execError = Object.assign(new Error("spawn gh ENOENT"), {
      name: "ProcessExecutionError",
    });
    Object.setPrototypeOf(execError, ProcessExecutionError.prototype);
    mockedRunCommand.mockRejectedValue(execError);

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(GitHubCLIError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
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
        labels: [{ name: "claude/plan" }, { name: "priority:high" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(1);
    const issue = issues[0];
    expect(issue.number).toBe(1);
    expect(issue.title).toBe("First issue");
    expect(issue.body).toBe("Body text");
    expect(issue.labels).toEqual(["claude/plan", "priority:high"]);
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

    const issues = await fetchIssues(makeRepoConfig(), Phase.IMPL);

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

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues[0].body).toBeNull();
  });

  it("不正な JSON の場合 IssueParseError が throw される", async () => {
    mockGhSuccess("not valid json");

    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow("Failed to parse JSON");
  });

  it("空の JSON 配列は空リストを返す", async () => {
    mockGhSuccess("[]");

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
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
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
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
      fetchIssues(makeRepoConfig(), Phase.PLAN),
    ).rejects.toThrow(IssueParseError);
    await expect(
      fetchIssues(makeRepoConfig(), Phase.PLAN),
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

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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

    const result = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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

    const result = await fetchIssues(makeRepoConfig(), Phase.PLAN);

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
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("MEMBER の Issue は処理対象に含まれる", async () => {
    const rawJson = makeGhJson([
      {
        number: 2,
        title: "Member issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/2",
        author_association: "MEMBER",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(2);
  });

  it("COLLABORATOR の Issue は処理対象に含まれる", async () => {
    const rawJson = makeGhJson([
      {
        number: 3,
        title: "Collaborator issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "COLLABORATOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(3);
  });

  it("NONE の Issue はフィルタリングされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 10,
        title: "External issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/10",
        author_association: "NONE",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(0);
  });

  it("FIRST_TIME_CONTRIBUTOR の Issue はフィルタリングされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 11,
        title: "First timer issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/11",
        author_association: "FIRST_TIME_CONTRIBUTOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(0);
  });

  it("許可された Issue と許可されない Issue が混在する場合、許可された Issue のみ返される", async () => {
    const rawJson = makeGhJson([
      {
        number: 1,
        title: "Owner issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/1",
        author_association: "OWNER",
      },
      {
        number: 2,
        title: "External issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/2",
        author_association: "NONE",
      },
      {
        number: 3,
        title: "Member issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/3",
        author_association: "MEMBER",
      },
      {
        number: 4,
        title: "Contributor issue",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/4",
        author_association: "CONTRIBUTOR",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
  });

  it("authorAssociation が未定義の場合フィルタリングされる", async () => {
    const rawJson = makeGhJson([
      {
        number: 20,
        title: "No association",
        body: "body",
        labels: [{ name: "claude/plan" }],
        html_url: "https://github.com/nonz250/example-app/issues/20",
      },
    ]);
    mockGhSuccess(rawJson);

    const issues = await fetchIssues(makeRepoConfig(), Phase.PLAN);

    expect(issues).toHaveLength(0);
  });
});
