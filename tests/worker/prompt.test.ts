import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPrompt,
  PromptTemplateError,
} from "../../src/worker/prompt.js";
import { Phase, Priority } from "../../src/worker/models.js";
import type { Issue, RepositoryConfig } from "../../src/worker/models.js";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExistsSync = vi.mocked(existsSync);

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
  "{boundary_open}",
  "{issue_body}",
  "{boundary_close}",
].join("\n") + "\n";

const MINIMAL_IMPL_TEMPLATE = [
  "Implement for {repo_full_name}",
  "Issue #{issue_number}: {issue_title}",
  "close {issue_url}",
  "{boundary_open}",
  "{issue_body}",
  "{boundary_close}",
].join("\n") + "\n";

/** UUID v4 の形式にマッチする正規表現 */
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** バウンダリ開始マーカーの正規表現 */
const BOUNDARY_OPEN_PATTERN = new RegExp(
  `<!-- BOUNDARY-${UUID_PATTERN} DATA START -->`,
);

/** バウンダリ終了マーカーの正規表現 */
const BOUNDARY_CLOSE_PATTERN = new RegExp(
  `<!-- BOUNDARY-${UUID_PATTERN} DATA END -->`,
);

// ---------------------------------------------------------------------------
// 正常系テスト
// ---------------------------------------------------------------------------

describe("buildPrompt - 正常系", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Plan フェーズで指定ディレクトリからテンプレートを読み込む", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toContain("Repo: testowner/testrepo");
    expect(result).toContain("Owner: testowner");
    expect(result).toContain("Name: testrepo");
    expect(result).toContain("Issue #42: Test Issue Title");
    expect(result).toContain("URL: https://github.com/testowner/testrepo/issues/42");
    expect(result).toContain("This is the issue body.");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
    expect(mockedExistsSync).toHaveBeenCalledWith(
      resolve("/tmp/prompts", "plan.md"),
    );
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      resolve("/tmp/prompts", "plan.md"),
      "utf-8",
    );
  });

  it("Impl フェーズでプロンプトが正しく生成される", () => {
    mockedExistsSync.mockReturnValue(true);
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
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");

    const result = buildPrompt(
      makeIssue({ body: null }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
    // バウンダリの間が空行（空文字列に変換されている）
    const lines = result.split("\n");
    expect(lines[1]).toBe("");
  });

  it("テンプレートに含まれない変数があっても問題なく動作する", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("Only title: {issue_title}");

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toContain("Only title: Test Issue Title");
  });

  it("Issue 本文に { や } が含まれていてもエラーにならない", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");
    const bodyWithBraces = "function() { return {key: value}; }";

    const result = buildPrompt(
      makeIssue({ body: bodyWithBraces }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toContain(bodyWithBraces);
  });

  it("Issue 本文にプレースホルダ風文字列が含まれていても二重展開されない", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}\nURL: {issue_url}",
    );
    const maliciousBody = "See {issue_url} for details";

    const result = buildPrompt(
      makeIssue({ body: maliciousBody }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toContain("See {issue_url} for details");
    expect(result).toContain(
      "URL: https://github.com/testowner/testrepo/issues/42",
    );
  });

  it("Issue 本文に $& や $' を含む場合でも安全に展開される", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");
    const bodyWithDollar = "price is $& and $' and $` and $$";

    const result = buildPrompt(
      makeIssue({ body: bodyWithDollar }),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toContain(bodyWithDollar);
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
    mockedExistsSync.mockReturnValue(false);

    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "/tmp/prompts"),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "/tmp/prompts"),
    ).toThrow("Template file not found: plan.md");
  });

  it("ファイルが存在するが読み込みに失敗した場合、PromptTemplateError が発生する", () => {
    mockedExistsSync.mockReturnValue(true);
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
    ).toThrow("Failed to read template file: plan.md");
  });
});

// ---------------------------------------------------------------------------
// ランダムバウンダリテスト
// ---------------------------------------------------------------------------

describe("buildPrompt - ランダムバウンダリ", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("レンダリング結果にランダムバウンダリが含まれる", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("固定の <issue-body> タグが結果に含まれない", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    expect(result).not.toContain("<issue-body>");
    expect(result).not.toContain("</issue-body>");
  });

  it("バウンダリの形式が <!-- BOUNDARY- で始まる", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^<!-- BOUNDARY-/);
    expect(lines[0]).toMatch(/ DATA START -->$/);
    expect(lines[2]).toMatch(/^<!-- BOUNDARY-/);
    expect(lines[2]).toMatch(/ DATA END -->$/);
  });

  it("バウンダリの開始と終了に同一のトークンが使われる", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    const openMatch = result.match(
      /<!-- BOUNDARY-([0-9a-f-]+) DATA START -->/,
    );
    const closeMatch = result.match(
      /<!-- BOUNDARY-([0-9a-f-]+) DATA END -->/,
    );
    expect(openMatch).not.toBeNull();
    expect(closeMatch).not.toBeNull();
    expect(openMatch![1]).toBe(closeMatch![1]);
  });

  it("呼び出しごとに異なるトークンが生成される", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result1 = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );
    const result2 = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "/tmp/prompts",
    );

    const token1 = result1.match(
      /<!-- BOUNDARY-([0-9a-f-]+) DATA START -->/,
    )![1];
    const token2 = result2.match(
      /<!-- BOUNDARY-([0-9a-f-]+) DATA START -->/,
    )![1];
    expect(token1).not.toBe(token2);
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
    "boundary_open",
    "boundary_close",
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
    mockedExistsSync.mockImplementation(actualFs.existsSync as typeof existsSync);
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
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
    expect(result).not.toContain("<issue-body>");
    expect(result).not.toContain("</issue-body>");
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
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
    expect(result).not.toContain("<issue-body>");
    expect(result).not.toContain("</issue-body>");
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
