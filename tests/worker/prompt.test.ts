import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPrompt,
  PromptTemplateError,
} from "../../src/worker/prompt.js";
import { Phase, Priority } from "../../src/worker/models.js";
import type { Issue, RepositoryConfig } from "../../src/worker/models.js";

const mockedReadFileSync = vi.mocked(readFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoConfig(
  owner = "testowner",
  repo = "testrepo",
): RepositoryConfig {
  return {
    owner,
    repo,
    localPath: "/tmp/testowner/testrepo",
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

function makeIssue(overrides?: Partial<Issue>): Issue {
  return {
    number: 42,
    title: "Test Issue Title",
    body: "This is the issue body.",
    labels: ["claude/plan"],
    url: "https://github.com/testowner/testrepo/issues/42",
    phase: Phase.PLAN,
    priority: Priority.NONE,
    ...overrides,
  };
}

const MINIMAL_PLAN_TEMPLATE = [
  "Repo: {repo_full_name}",
  "Owner: {repo_owner}",
  "Name: {repo_name}",
  "Issue #{issue_number}: {issue_title}",
  "URL: {issue_url}",
  "Body: {issue_body}",
].join("\n") + "\n";

const MINIMAL_IMPL_TEMPLATE = [
  "Implement for {repo_full_name}",
  "Issue #{issue_number}: {issue_title}",
  "close {issue_url}",
  "Body: {issue_body}",
].join("\n") + "\n";

// ---------------------------------------------------------------------------
// 正常系テスト
// ---------------------------------------------------------------------------

describe("buildPrompt - 正常系", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Plan フェーズでプロンプトが正しく生成される", () => {
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toBe(
      "Repo: testowner/testrepo\n" +
      "Owner: testowner\n" +
      "Name: testrepo\n" +
      "Issue #42: Test Issue Title\n" +
      "URL: https://github.com/testowner/testrepo/issues/42\n" +
      "Body: This is the issue body.\n",
    );
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      resolve("/tmp/prompts", "plan.md"),
      "utf-8",
    );
  });

  it("Impl フェーズでプロンプトが正しく生成される", () => {
    mockedReadFileSync.mockReturnValue(MINIMAL_IMPL_TEMPLATE);

    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 99,
        title: "Implement feature",
      }),
      makeRepoConfig("myorg", "myapp"),
      "/tmp/prompts",
    );

    expect(result).toContain("Implement for myorg/myapp");
    expect(result).toContain("Issue #99: Implement feature");
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      resolve("/tmp/prompts", "impl.md"),
      "utf-8",
    );
  });

  it("issue.body が null の場合、空文字列に変換される", () => {
    mockedReadFileSync.mockReturnValue("Body: {issue_body}");

    const result = buildPrompt(
      makeIssue({ body: null }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toBe("Body: ");
  });

  it("テンプレートに含まれない変数があっても問題なく動作する", () => {
    mockedReadFileSync.mockReturnValue("Only title: {issue_title}");

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toBe("Only title: Test Issue Title");
  });

  it("Issue 本文に { や } が含まれていてもエラーにならない", () => {
    mockedReadFileSync.mockReturnValue("Body: {issue_body}");
    const bodyWithBraces = "function() { return {key: value}; }";

    const result = buildPrompt(
      makeIssue({ body: bodyWithBraces }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toBe(`Body: ${bodyWithBraces}`);
  });

  it("Issue 本文にプレースホルダ風文字列が含まれていても二重展開されない", () => {
    mockedReadFileSync.mockReturnValue(
      "Body: {issue_body}\nURL: {issue_url}",
    );
    const maliciousBody = "See {issue_url} for details";

    const result = buildPrompt(
      makeIssue({ body: maliciousBody }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    const lines = result.split("\n");
    expect(lines[0]).toBe("Body: See {issue_url} for details");
    expect(lines[1]).toBe(
      "URL: https://github.com/testowner/testrepo/issues/42",
    );
  });

  it("Issue 本文に $& や $' を含む場合でも安全に展開される", () => {
    mockedReadFileSync.mockReturnValue("Body: {issue_body}");
    const bodyWithDollar = "price is $& and $' and $` and $$";

    const result = buildPrompt(
      makeIssue({ body: bodyWithDollar }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toBe(`Body: ${bodyWithDollar}`);
  });
});

// ---------------------------------------------------------------------------
// 異常系テスト
// ---------------------------------------------------------------------------

describe("buildPrompt - 異常系", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("テンプレートファイルが存在しない場合、PromptTemplateError が発生する", () => {
    const enoentError = new Error("ENOENT") as NodeJS.ErrnoException;
    enoentError.code = "ENOENT";
    mockedReadFileSync.mockImplementation(() => {
      throw enoentError;
    });

    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "/tmp/prompts"),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "/tmp/prompts"),
    ).toThrow("Template file not found");
  });

  it("ファイル読み込みで ENOENT 以外のエラーの場合、PromptTemplateError が発生する", () => {
    const permError = new Error("EACCES") as NodeJS.ErrnoException;
    permError.code = "EACCES";
    mockedReadFileSync.mockImplementation(() => {
      throw permError;
    });

    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "/tmp/prompts"),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "/tmp/prompts"),
    ).toThrow("Failed to read template file");
  });
});

// ---------------------------------------------------------------------------
// インテグレーションテスト（実際のテンプレートファイルを使用）
// ---------------------------------------------------------------------------

describe("buildPrompt - インテグレーション", () => {
  const KNOWN_PLACEHOLDERS = [
    "repo_full_name",
    "repo_owner",
    "repo_name",
    "issue_number",
    "issue_title",
    "issue_url",
    "issue_body",
  ];

  function findUnexpandedPlaceholders(text: string): string[] {
    const unexpanded: string[] = [];
    for (const placeholder of KNOWN_PLACEHOLDERS) {
      const pattern = new RegExp(`\\{${placeholder}\\}`);
      if (pattern.test(text)) {
        unexpanded.push(placeholder);
      }
    }
    return unexpanded;
  }

  // インテグレーションテストでは実際のファイルを読むためモックに実実装を設定する
  beforeEach(async () => {
    vi.restoreAllMocks();
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    mockedReadFileSync.mockImplementation(actualFs.readFileSync as typeof readFileSync);
  });

  it("実際の plan.md テンプレートで全プレースホルダが展開される", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.PLAN,
        number: 101,
        title: "Add new feature",
        body: "Please add a search feature to the application.",
        url: "https://github.com/testowner/testrepo/issues/101",
      }),
      makeRepoConfig(),
    );

    const unexpanded = findUnexpandedPlaceholders(result);
    expect(unexpanded).toEqual([]);
    expect(result).toContain("testowner/testrepo");
    expect(result).toContain("#101");
    expect(result).toContain("Add new feature");
  });

  it("実際の impl.md テンプレートで全プレースホルダが展開される", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 202,
        title: "Implement search feature",
        body: "Implement the search feature as described in the plan.",
        url: "https://github.com/testowner/testrepo/issues/202",
      }),
      makeRepoConfig(),
    );

    const unexpanded = findUnexpandedPlaceholders(result);
    expect(unexpanded).toEqual([]);
    expect(result).toContain("testowner/testrepo");
    expect(result).toContain("#202");
    expect(result).toContain("Implement search feature");
  });

  it("impl.md のプロンプトに close {issue_url} の展開結果が含まれる", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 202,
        title: "Implement search feature",
        body: "Implement the search feature as described in the plan.",
        url: "https://github.com/testowner/testrepo/issues/202",
      }),
      makeRepoConfig(),
    );

    expect(result).toContain(
      "close https://github.com/testowner/testrepo/issues/202",
    );
  });
});
