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

import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
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
const mockedRealpathSync = vi.mocked(realpathSync);
const mockedGetUserPromptsDir = vi.mocked(getUserPromptsDir);
const mockedGetDefaultPromptsDir = vi.mocked(getDefaultPromptsDir);

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
    mockedRealpathSync.mockImplementation(actualFs.realpathSync as typeof realpathSync);
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
// Custom prompt directory tests (tier 1)
// ---------------------------------------------------------------------------

describe("buildPrompt - custom prompt directory (tier 1)", () => {
  const CUSTOM_DIR = "/custom/prompts";
  const CUSTOM_TEMPLATE = "{boundary_open}\nCustom: {issue_title}\n{boundary_close}";

  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
  });

  function setupCustomDirMocks(customExists: boolean): void {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(CUSTOM_DIR)) return customExists;
      if (path.startsWith(USER_DIR)) return false;
      return true; // default dir always exists
    });
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
    mockedRealpathSync.mockImplementation((p) => String(p));
  }

  it("Uses custom directory template when it exists", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue(CUSTOM_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      "ja",
    );

    expect(result).toContain("Custom: Test Issue Title");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
  });

  it("Falls back to default when custom directory template missing", () => {
    setupCustomDirMocks(false);
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      "ja",
    );

    expect(result).toContain("Repo: testowner/testrepo");
  });

  it("PromptTemplateError when custom template missing {boundary_open}", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue("Custom: {issue_title}\n{boundary_close}");

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(/missing required boundary placeholders.*\{boundary_open\}/);
  });

  it("PromptTemplateError when custom template missing {boundary_close}", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue("{boundary_open}\nCustom: {issue_title}");

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(/missing required boundary placeholders.*\{boundary_close\}/);
  });

  it("Both missing boundary placeholders are reported", () => {
    setupCustomDirMocks(true);
    mockedReadFileSync.mockReturnValue("No boundary: {issue_title}");

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(/\{boundary_open\}.*\{boundary_close\}/);
  });

  it("Uses default directory only when promptsDir is null", () => {
    setupDefaultDirMocks();
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("Repo: testowner/testrepo");
  });

  it("PromptTemplateError when template path escapes custom directory", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
    mockedRealpathSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("plan.md")) return "/etc/passwd";
      return CUSTOM_DIR;
    });

    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(
        makeIssue(),
        makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
        "ja",
      ),
    ).toThrow(/escapes the prompts directory/);
  });
});

// ---------------------------------------------------------------------------
// User prompt directory tests (tier 2)
// ---------------------------------------------------------------------------

describe("buildPrompt - user prompt directory (tier 2)", () => {
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
    mockedRealpathSync.mockImplementation((p) => String(p));
  }

  it("Uses user directory template when it exists (with boundary validation)", () => {
    setupUserDirMocks(true);
    mockedReadFileSync.mockReturnValue(USER_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("User: Test Issue Title");
    expect(result).toMatch(BOUNDARY_OPEN_PATTERN);
    expect(result).toMatch(BOUNDARY_CLOSE_PATTERN);
  });

  it("PromptTemplateError when user template missing boundary placeholders", () => {
    setupUserDirMocks(true);
    mockedReadFileSync.mockReturnValue("User: {issue_title}");

    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "ja"),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "ja"),
    ).toThrow(/missing required boundary placeholders/);
  });

  it("PromptTemplateError when user template path escapes directory", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(USER_DIR)) return true;
      return true;
    });
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
    mockedRealpathSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("plan.md")) return "/etc/shadow";
      return USER_DIR;
    });

    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "ja"),
    ).toThrow(PromptTemplateError);
    expect(() =>
      buildPrompt(makeIssue(), makeRepoConfig(), "ja"),
    ).toThrow(/escapes the prompts directory/);
  });

  it("Falls back to package default when user directory is empty", () => {
    setupUserDirMocks(false);
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(makeIssue(), makeRepoConfig(), "ja");

    expect(result).toContain("Repo: testowner/testrepo");
  });
});

// ---------------------------------------------------------------------------
// 3-tier priority tests
// ---------------------------------------------------------------------------

describe("buildPrompt - 3-tier priority", () => {
  const CUSTOM_DIR = "/custom/prompts";
  const CUSTOM_TEMPLATE = "{boundary_open}\nCustom: {issue_title}\n{boundary_close}";
  const USER_TEMPLATE = "{boundary_open}\nUser: {issue_title}\n{boundary_close}";

  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetUserPromptsDir.mockReturnValue(USER_DIR);
    mockedGetDefaultPromptsDir.mockReturnValue(DEFAULT_DIR);
    mockedStatSync.mockReturnValue({ size: 1024, isFile: () => true } as unknown as ReturnType<typeof statSync>);
    mockedRealpathSync.mockImplementation((p) => String(p));
  });

  it("Tier 1 (custom) wins when all 3 tiers have templates", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(CUSTOM_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      "ja",
    );

    expect(result).toContain("Custom: Test Issue Title");
  });

  it("Tier 2 (user) wins when tier 1 is empty and tiers 2 and 3 have templates", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(CUSTOM_DIR)) return false;
      return true; // user dir and default dir exist
    });
    mockedReadFileSync.mockReturnValue(USER_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      "ja",
    );

    expect(result).toContain("User: Test Issue Title");
  });

  it("Tier 3 (default) wins when tiers 1 and 2 are empty", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.startsWith(CUSTOM_DIR)) return false;
      if (path.startsWith(USER_DIR)) return false;
      return true; // default dir exists
    });
    mockedReadFileSync.mockReturnValue(MINIMAL_PLAN_TEMPLATE);

    const result = buildPrompt(
      makeIssue(),
      makeRepoConfig("testowner", "testrepo", CUSTOM_DIR),
      "ja",
    );

    expect(result).toContain("Repo: testowner/testrepo");
  });
});
