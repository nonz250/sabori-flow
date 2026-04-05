import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

// logger 出力を抑制
vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPrompt,
  PromptTemplateError,
} from "../../src/worker/prompt.js";
import { Phase, Priority } from "../../src/worker/models.js";
import type { Issue, RepositoryConfig } from "../../src/worker/models.js";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedStatSync = vi.mocked(statSync);
const mockedRealpathSync = vi.mocked(realpathSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoConfig(
  owner = "testowner",
  repo = "testrepo",
  promptsDir: string | null = null,
): RepositoryConfig {
  return {
    owner,
    repo,
    localPath: "/tmp/testowner/testrepo",
    promptsDir,
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
    autoImplAfterPlan: false,
  };
}

function makeIssue(overrides?: Partial<Issue>): Issue {
  return {
    number: 42,
    title: "Test Issue Title",
    body: "This is the issue body.",
    labels: ["claude/plan"],
    url: "https://github.com/testowner/testrepo/issues/42",
    authorAssociation: "OWNER",
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

/** デフォルトディレクトリから読み込む場合の共通セットアップ */
function setupDefaultDirMocks(): void {
  mockedExistsSync.mockReturnValue(true);
  mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
}

describe("buildPrompt - 正常系", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Plan フェーズでデフォルトディレクトリからテンプレートを読み込む", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig());

    expect(result).toContain("Repo: testowner/testrepo");
    expect(result).toContain("Owner: testowner");
    expect(result).toContain("Name: testrepo");
    expect(result).toContain("Issue #42: Test Issue Title");
    expect(result).toContain("URL: https://github.com/testowner/testrepo/issues/42");
    expect(result).toContain("This is the issue body.");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("Impl フェーズでプロンプトが正しく生成される", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(MINIMAL_IMPL_TEMPLATE);

    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 99,
        title: "Implement feature",
      }),
      makeRepoConfig("myorg", "myapp"),
    );

    expect(result).toContain("Implement for myorg/myapp");
    expect(result).toContain("Issue #99: Implement feature");
  });

  it("issue.body が null の場合、空文字列に変換される", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");

    const result = buildPrompt(makeIssue({ body: null }), makeRepoConfig());

    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
    const lines = result.split("\n");
    expect(lines[1]).toBe("");
  });

  it("テンプレートに含まれない変数があっても問題なく動作する", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("Only title: {issue_title}");

    const result = buildPrompt(makeIssue(), makeRepoConfig());

    expect(result).toContain("Only title: Test Issue Title");
  });

  it("Issue 本文に { や } が含まれていてもエラーにならない", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");
    const bodyWithBraces = "function() { return {key: value}; }";

    const result = buildPrompt(
      makeIssue({ body: bodyWithBraces }),
      makeRepoConfig(),
    );

    expect(result).toContain(bodyWithBraces);
  });

  it("Issue 本文にプレースホルダ風文字列が含まれていても二重展開されない", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}\nURL: {issue_url}",
    );
    const maliciousBody = "See {issue_url} for details";

    const result = buildPrompt(
      makeIssue({ body: maliciousBody }),
      makeRepoConfig(),
    );

    expect(result).toContain("See {issue_url} for details");
    expect(result).toContain(
      "URL: https://github.com/testowner/testrepo/issues/42",
    );
  });

  it("Issue 本文に $& や $' を含む場合でも安全に展開される", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");
    const bodyWithDollar = "price is $& and $' and $` and $$";

    const result = buildPrompt(
      makeIssue({ body: bodyWithDollar }),
      makeRepoConfig(),
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

    expect(() => buildPrompt(makeIssue(), makeRepoConfig())).toThrow(
      PromptTemplateError,
    );
    expect(() => buildPrompt(makeIssue(), makeRepoConfig())).toThrow(
      "Template file not found: plan.md",
    );
  });

  it("ファイルが存在するが読み込みに失敗した場合、PromptTemplateError が発生する", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(() => buildPrompt(makeIssue(), makeRepoConfig())).toThrow(
      PromptTemplateError,
    );
    expect(() => buildPrompt(makeIssue(), makeRepoConfig())).toThrow(
      "Failed to read template file: plan.md",
    );
  });

  it("テンプレートファイルがサイズ上限を超える場合、PromptTemplateError が発生する", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({
      size: 200 * 1024,
      isFile: () => true,
    } as unknown as ReturnType<typeof statSync>);

    expect(() => buildPrompt(makeIssue(), makeRepoConfig())).toThrow(
      PromptTemplateError,
    );
    expect(() => buildPrompt(makeIssue(), makeRepoConfig())).toThrow(
      /Template file too large/,
    );
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
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig());

    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("固定の <issue-body> タグが結果に含まれない", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig());

    expect(result).not.toContain("<issue-body>");
    expect(result).not.toContain("</issue-body>");
  });

  it("バウンダリの形式が <!-- BOUNDARY- で始まる", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig());

    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^<!-- BOUNDARY-/);
    expect(lines[0]).toMatch(/ DATA START -->$/);
    expect(lines[2]).toMatch(/^<!-- BOUNDARY-/);
    expect(lines[2]).toMatch(/ DATA END -->$/);
  });

  it("バウンダリの開始と終了に同一のトークンが使われる", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig());

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
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result1 = buildPrompt(makeIssue(), makeRepoConfig());
    const result2 = buildPrompt(makeIssue(), makeRepoConfig());

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
    mockedStatSync.mockImplementation(actualFs.statSync as typeof statSync);
    mockedRealpathSync.mockImplementation(actualFs.realpathSync as typeof realpathSync);
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

// ---------------------------------------------------------------------------
// カスタムプロンプトディレクトリテスト
// ---------------------------------------------------------------------------

describe("buildPrompt - カスタムプロンプトディレクトリ", () => {
  const CUSTOM_DIR = "/custom/prompts";
  const CUSTOM_TEMPLATE = "{boundary_open}\nCustom: {issue_title}\n{boundary_close}";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** カスタムディレクトリのモックを設定する */
  function setupCustomDirMocks(customExists: boolean): void {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(CUSTOM_DIR)) return customExists;
      return true; // default dir always exists
    });
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
    mockedRealpathSync.mockImplementation((p) => String(p));
  }

  it("カスタムディレクトリにテンプレートが存在する場合、そちらを使用する", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue(CUSTOM_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
    );

    expect(result).toContain("Custom: Test Issue Title");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
  });

  it("カスタムディレクトリにテンプレートが存在しない場合、デフォルトにフォールバックする", () => {
    setupCustomDirMocks(false);
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
    );

    expect(result).toContain("Repo: testowner/testrepo");
  });

  it("カスタムテンプレートに {boundary_open} が欠けている場合、PromptTemplateError が発生する", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue("Custom: {issue_title}\n{boundary_close}");

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(/missing required boundary placeholders.*\{boundary_open\}/);
  });

  it("カスタムテンプレートに {boundary_close} が欠けている場合、PromptTemplateError が発生する", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue("{boundary_open}\nCustom: {issue_title}");

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(/missing required boundary placeholders.*\{boundary_close\}/);
  });

  it("カスタムテンプレートにバウンダリが両方欠けている場合、両方が報告される", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue("No boundary: {issue_title}");

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(/\{boundary_open\}.*\{boundary_close\}/);
  });

  it("promptsDir が null の場合、デフォルトディレクトリのみ使用する", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig());

    expect(result).toContain("Repo: testowner/testrepo");
  });

  it("テンプレートファイルのパスがカスタムディレクトリ外に逸脱した場合、PromptTemplateError が発生する", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
    // realpathSync がディレクトリ外のパスを返すことでパス逸脱を再現
    mockedRealpathSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("plan.md")) return "/etc/passwd";
      return CUSTOM_DIR;
    });

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      ),
    ).toThrow(/escapes the prompts directory/);
  });
});
