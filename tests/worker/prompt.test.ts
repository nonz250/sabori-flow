import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

// logger mock
vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// paths mock
vi.mock("../../src/utils/paths.js", () => ({
  getUserPromptsDir: vi.fn(() => "/mock/user/prompts"),
  getDefaultPromptsDir: vi.fn(() => "/mock/default/prompts"),
}));

import { existsSync, readFileSync, statSync } from "node:fs";
import {
  buildPrompt,
  PromptTemplateError,
} from "../../src/worker/prompt.js";
import { Phase, Priority } from "../../src/worker/models.js";
import type { Issue, RepositoryConfig } from "../../src/worker/models.js";
import { getUserPromptsDir, getDefaultPromptsDir } from "../../src/utils/paths.js";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedStatSync = vi.mocked(statSync);
const mockedGetUserPromptsDir = vi.mocked(getUserPromptsDir);
const mockedGetDefaultPromptsDir = vi.mocked(getDefaultPromptsDir);

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

/** UUID v4 pattern */
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const BOUNDARY_OPEN_PATTERN = new RegExp(
  `<!-- BOUNDARY-${UUID_PATTERN} DATA START -->`,
);

const BOUNDARY_CLOSE_PATTERN = new RegExp(
  `<!-- BOUNDARY-${UUID_PATTERN} DATA END -->`,
);

const USER_DIR = "/mock/user/prompts";
const DEFAULT_DIR = "/mock/default/prompts";

// ---------------------------------------------------------------------------
// Helper: default dir mock (user dir not found, default dir found)
// ---------------------------------------------------------------------------

function setupDefaultDirMocks(): void {
  mockedExistsSync.mockImplementation((p) => {
    const path = String(p);
    if (path.startsWith(USER_DIR)) return false;
    return true; // default dir exists
  });
  mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
}

// ---------------------------------------------------------------------------
// Normal cases
// ---------------------------------------------------------------------------

describe("buildPrompt - normal cases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
  });

  it("Plan phase loads template from default directory", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("Repo: testowner/testrepo");
    expect(result).toContain("Owner: testowner");
    expect(result).toContain("Name: testrepo");
    expect(result).toContain("Issue #42: Test Issue Title");
    expect(result).toContain("URL: https://github.com/testowner/testrepo/issues/42");
    expect(result).toContain("This is the issue body.");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("Impl phase generates prompt correctly", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(MINIMAL_IMPL_TEMPLATE);

    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 99,
        title: "Implement feature",
      }),
      makeRepoConfig("myorg", "myapp"),
      "ja",
    );

    expect(result).toContain("Implement for myorg/myapp");
    expect(result).toContain("Issue #99: Implement feature");
  });

  it("issue.body null is converted to empty string", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");

    const result = buildPrompt(makeIssue({ body: null }), makeRepoConfig(), "ja");

    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
    const lines = result.split("\n");
    expect(lines[1]).toBe("");
  });

  it("Works fine when template doesn't use all variables", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("Only title: {issue_title}");

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("Only title: Test Issue Title");
  });

  it("Issue body with { or } does not cause error", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");
    const bodyWithBraces = "function() { return {key: value}; }";

    const result = buildPrompt(
      makeIssue({ body: bodyWithBraces }),
      makeRepoConfig(),
      "ja",
    );

    expect(result).toContain(bodyWithBraces);
  });

  it("Placeholder-like strings in issue body are not double-expanded", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}\nURL: {issue_url}",
    );
    const maliciousBody = "See {issue_url} for details";

    const result = buildPrompt(
      makeIssue({ body: maliciousBody }),
      makeRepoConfig(),
      "ja",
    );

    expect(result).toContain("See {issue_url} for details");
    expect(result).toContain(
      "URL: https://github.com/testowner/testrepo/issues/42",
    );
  });

  it("Issue body with $& or $' is safely expanded", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue("{boundary_open}\n{issue_body}\n{boundary_close}");
    const bodyWithDollar = "price is $& and $' and $` and $$";

    const result = buildPrompt(
      makeIssue({ body: bodyWithDollar }),
      makeRepoConfig(),
      "ja",
    );

    expect(result).toContain(bodyWithDollar);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("buildPrompt - error cases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
  });

  it("PromptTemplateError when template file not found in any tier", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => buildPrompt(makeIssue(), makeRepoConfig(), "ja")).toThrow(
      PromptTemplateError,
    );
    expect(() => buildPrompt(makeIssue(), makeRepoConfig(), "ja")).toThrow(
      "Template file not found: plan.md",
    );
  });

  it("PromptTemplateError when file exists but read fails", () => {
    setupDefaultDirMocks();
    mockedStatSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(() => buildPrompt(makeIssue(), makeRepoConfig(), "ja")).toThrow(
      PromptTemplateError,
    );
    expect(() => buildPrompt(makeIssue(), makeRepoConfig(), "ja")).toThrow(
      "Failed to read template file: plan.md",
    );
  });

  it("PromptTemplateError when template file exceeds size limit", () => {
    setupDefaultDirMocks();
    mockedStatSync.mockReturnValue({
      size: 200 * 1024,
      isFile: () => true,
    } as unknown as ReturnType<typeof statSync>);

    expect(() => buildPrompt(makeIssue(), makeRepoConfig(), "ja")).toThrow(
      PromptTemplateError,
    );
    expect(() => buildPrompt(makeIssue(), makeRepoConfig(), "ja")).toThrow(
      /Template file too large/,
    );
  });
});

// ---------------------------------------------------------------------------
// Random boundary tests
// ---------------------------------------------------------------------------

describe("buildPrompt - random boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
  });

  it("Rendered result contains random boundary", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("Fixed <issue-body> tag is not in result", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).not.toContain("<issue-body>");
    expect(result).not.toContain("</issue-body>");
  });

  it("Boundary starts with <!-- BOUNDARY-", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^<!-- BOUNDARY-/);
    expect(lines[0]).toMatch(/ DATA START -->$/);
    expect(lines[2]).toMatch(/^<!-- BOUNDARY-/);
    expect(lines[2]).toMatch(/ DATA END -->$/);
  });

  it("Same token is used for boundary open and close", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

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

  it("Different tokens are generated per call", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(
      "{boundary_open}\n{issue_body}\n{boundary_close}",
    );

    const result1 = buildPrompt(makeIssue(), makeRepoConfig(), "ja");
    const result2 = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

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
// Integration tests (actual template files)
// ---------------------------------------------------------------------------

describe("buildPrompt - integration", () => {
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

  beforeEach(async () => {
    vi.restoreAllMocks();
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    mockedReadFileSync.mockImplementation(actualFs.readFileSync as typeof readFileSync);
    mockedExistsSync.mockImplementation(actualFs.existsSync as typeof existsSync);
    mockedStatSync.mockImplementation(actualFs.statSync as typeof statSync);
    // getUserPromptsDir returns a non-existent path so it falls through to package default
    mockedGetUserPromptsDir.mockReturnValue("/nonexistent/user/prompts");
    // getDefaultPromptsDir returns the real package prompts dir
    const actualPaths = await vi.importActual<typeof import("../../src/utils/paths.js")>("../../src/utils/paths.js");
    mockedGetDefaultPromptsDir.mockReturnValue(actualPaths.getDefaultPromptsDir());
  });

  it("All placeholders expanded in actual plan.md template", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.PLAN,
        number: 101,
        title: "Add new feature",
        body: "Please add a search feature to the application.",
        url: "https://github.com/testowner/testrepo/issues/101",
      }),
      makeRepoConfig(),
      "ja",
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

  it("All placeholders expanded in actual impl.md template", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 202,
        title: "Implement search feature",
        body: "Implement the search feature as described in the plan.",
        url: "https://github.com/testowner/testrepo/issues/202",
      }),
      makeRepoConfig(),
      "ja",
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

  it("impl.md prompt contains expanded close {issue_url}", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.IMPL,
        number: 202,
        title: "Implement search feature",
        body: "Implement the search feature as described in the plan.",
        url: "https://github.com/testowner/testrepo/issues/202",
      }),
      makeRepoConfig(),
      "ja",
    );

    expect(result).toContain(
      "close https://github.com/testowner/testrepo/issues/202",
    );
  });

  it("language=en uses prompts/en/ directory", () => {
    const result = buildPrompt(
      makeIssue({
        phase: Phase.PLAN,
        number: 101,
        title: "Add new feature",
        body: "Please add a search feature.",
        url: "https://github.com/testowner/testrepo/issues/101",
      }),
      makeRepoConfig(),
      "en",
    );

    const unexpanded = findUnexpandedPlaceholders(result);
    expect(unexpanded).toEqual([]);
    expect(result).toContain("testowner/testrepo");
    expect(result).toContain("#101");
  });
});

// ---------------------------------------------------------------------------
// User prompt directory tests
// ---------------------------------------------------------------------------

describe("buildPrompt - user prompt directory", () => {
  const USER_TEMPLATE = "{boundary_open}\nUser: {issue_title}\n{boundary_close}";

  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
  });

  function setupUserDirMocks(userExists: boolean): void {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(USER_DIR)) return userExists;
      return true; // default dir always exists
    });
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
  }

  it("Uses user directory template when it exists", () => {
    setupUserDirMocks(true);
    mockedReadFileSync.mockReturnValue(USER_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("User: Test Issue Title");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("Falls back to package default when user directory is empty", () => {
    setupUserDirMocks(false);
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("Repo: testowner/testrepo");
  });
});

// ---------------------------------------------------------------------------
// 2-tier priority tests
// ---------------------------------------------------------------------------

describe("buildPrompt - 2-tier priority", () => {
  const USER_TEMPLATE = "{boundary_open}\nUser: {issue_title}\n{boundary_close}";

  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
  });

  it("Tier 1 (user) wins when both tiers have templates", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(USER_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "ja",
    );

    expect(result).toContain("User: Test Issue Title");
  });

  it("Tier 2 (default) wins when tier 1 is empty", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(USER_DIR)) return false;
      return true; // default dir exists
    });
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig(),
      "ja",
    );

    expect(result).toContain("Repo: testowner/testrepo");
  });
});
