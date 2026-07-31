import { describe, it, expect } from "vitest";
import YAML from "yaml";
import {
  collectPendingSteps,
  readSchemaVersion,
  readIntervalMinutes,
  validateBranchNameInput,
  validateIntegerInput,
  CURRENT_SCHEMA_VERSION,
} from "../../../src/commands/helpers/migration-steps.js";

// ---------- Helpers ----------

function doc(yaml: string) {
  return YAML.parseDocument(yaml);
}

const FULL_CONFIG = `\
schema_version: 1
language: ja
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    default_branch: main
    auto_impl_after_plan: false
    labels:
      plan:
        trigger: "claude/plan"
        in_progress: "claude/plan:in-progress"
        done: "claude/plan:done"
        failed: "claude/plan:failed"
      impl:
        trigger: "claude/impl"
        in_progress: "claude/impl:in-progress"
        done: "claude/impl:done"
        failed: "claude/impl:failed"
    priority_labels:
      - "priority:high"
      - "priority:low"
execution:
  max_parallel: 2
  max_issues_per_repo: 3
  autonomy: auto
  interval_minutes: 30
  timeout_minutes: 120
`;

const MINIMAL_CONFIG = `\
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
`;

// ---------- collectPendingSteps ----------

describe("collectPendingSteps", () => {
  it("returns all expected steps when all keys are missing", () => {
    const result = collectPendingSteps(doc(MINIMAL_CONFIG));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = result.steps.map((s) => s.id);
    expect(ids).toEqual([
      "language",
      "execution.max_parallel",
      "execution.max_issues_per_repo",
      "execution.autonomy",
      "execution.interval_minutes",
      "execution.timeout_minutes",
      "repositories[0].default_branch",
      "repositories[0].auto_impl_after_plan",
      "repositories[0].labels",
      "repositories[0].priority_labels",
    ]);
  });

  it("returns step paths matching their ids", () => {
    const result = collectPendingSteps(doc(MINIMAL_CONFIG));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.steps[0].path).toEqual(["language"]);
    expect(result.steps[4].path).toEqual(["execution", "interval_minutes"]);
    expect(result.steps[6].path).toEqual(["repositories", 0, "default_branch"]);
  });

  it("returns zero steps when all keys are present", () => {
    const result = collectPendingSteps(doc(FULL_CONFIG));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(0);
  });

  it("returns only missing keys when some are present", () => {
    const yaml = `\
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    default_branch: develop
execution:
  max_parallel: 1
`;
    const result = collectPendingSteps(doc(yaml));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = result.steps.map((s) => s.id);
    expect(ids).toContain("language");
    expect(ids).toContain("execution.max_issues_per_repo");
    expect(ids).toContain("execution.autonomy");
    expect(ids).toContain("execution.interval_minutes");
    expect(ids).toContain("execution.timeout_minutes");
    expect(ids).toContain("repositories[0].auto_impl_after_plan");
    expect(ids).toContain("repositories[0].labels");
    expect(ids).toContain("repositories[0].priority_labels");
    expect(ids).not.toContain("execution.max_parallel");
    expect(ids).not.toContain("repositories[0].default_branch");
  });

  it("handles multiple repositories", () => {
    const yaml = `\
repositories:
  - owner: acme
    repo: app1
    local_path: /tmp/acme/app1
  - owner: acme
    repo: app2
    local_path: /tmp/acme/app2
`;
    const result = collectPendingSteps(doc(yaml));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = result.steps.map((s) => s.id);
    expect(ids).toContain("repositories[0].default_branch");
    expect(ids).toContain("repositories[1].default_branch");
    expect(ids).toContain("repositories[0].auto_impl_after_plan");
    expect(ids).toContain("repositories[1].auto_impl_after_plan");
  });

  // --- Failure: not-a-mapping ---

  it("fails when top-level is an array", () => {
    const result = collectPendingSteps(doc("- item1\n- item2\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("not-a-mapping");
  });

  it("fails when top-level is a scalar", () => {
    const result = collectPendingSteps(doc("just a string\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("not-a-mapping");
  });

  // --- Failure: repositories-invalid ---

  it("fails when repositories key is absent", () => {
    const result = collectPendingSteps(doc("language: ja\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("repositories-invalid");
  });

  it("fails when repositories is a string", () => {
    const result = collectPendingSteps(doc("repositories: not_a_list\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("repositories-invalid");
  });

  it("fails when repositories is a mapping", () => {
    const result = collectPendingSteps(doc("repositories:\n  key: value\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("repositories-invalid");
  });

  it("fails when a repository element is not a mapping", () => {
    const result = collectPendingSteps(doc("repositories:\n  - just_a_string\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("repositories-invalid");
  });

  it("succeeds with empty repositories array (zero repo steps)", () => {
    const result = collectPendingSteps(doc("repositories: []\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repoSteps = result.steps.filter((s) => s.id.startsWith("repositories["));
    expect(repoSteps).toHaveLength(0);
  });

  // --- Failure: schema-version-newer ---

  it("fails when schema_version exceeds CURRENT_SCHEMA_VERSION", () => {
    const result = collectPendingSteps(doc(`schema_version: 2\nrepositories: []\n`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: "schema-version-newer",
      recorded: 2,
      supported: CURRENT_SCHEMA_VERSION,
    });
  });

  // --- schema_version anomalies → treated as 0, ok ---

  it("succeeds when schema_version is a string (treated as 0)", () => {
    const result = collectPendingSteps(doc('schema_version: "one"\nrepositories: []\n'));
    expect(result.ok).toBe(true);
  });

  it("succeeds when schema_version is negative (treated as 0)", () => {
    const result = collectPendingSteps(doc("schema_version: -1\nrepositories: []\n"));
    expect(result.ok).toBe(true);
  });

  it("succeeds when schema_version is null (treated as 0)", () => {
    const result = collectPendingSteps(doc("schema_version: null\nrepositories: []\n"));
    expect(result.ok).toBe(true);
  });

  // --- Existing but invalid values are intentionally not flagged ---

  it("does not flag an existing-but-invalid default_branch (loadConfig detects it instead)", () => {
    const yaml = `\
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    default_branch: ""
`;
    const result = collectPendingSteps(doc(yaml));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.steps.map((s) => s.id);
    expect(ids).not.toContain("repositories[0].default_branch");
  });

  it("does not flag default_branch: null (loadConfig detects it instead)", () => {
    const yaml = `\
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    default_branch: null
`;
    const result = collectPendingSteps(doc(yaml));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.steps.map((s) => s.id);
    expect(ids).not.toContain("repositories[0].default_branch");
  });
});

// ---------- readSchemaVersion ----------

describe("readSchemaVersion", () => {
  it("returns 0 when key is absent", () => {
    expect(readSchemaVersion(doc("repositories: []\n"))).toBe(0);
  });

  it("returns the value when it is a valid integer", () => {
    expect(readSchemaVersion(doc("schema_version: 1\n"))).toBe(1);
  });

  it("returns 0 for a string value", () => {
    expect(readSchemaVersion(doc('schema_version: "one"\n'))).toBe(0);
  });

  it("returns 0 for a negative value", () => {
    expect(readSchemaVersion(doc("schema_version: -1\n"))).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(readSchemaVersion(doc("schema_version: null\n"))).toBe(0);
  });

  it("returns 0 for a float", () => {
    expect(readSchemaVersion(doc("schema_version: 1.5\n"))).toBe(0);
  });
});

// ---------- readIntervalMinutes ----------

describe("readIntervalMinutes", () => {
  it("returns default when key is absent", () => {
    expect(readIntervalMinutes(doc("repositories: []\n"))).toBe(60);
  });

  it("returns 60 for value 60", () => {
    expect(readIntervalMinutes(doc("execution:\n  interval_minutes: 60\n"))).toBe(60);
  });

  it("returns 90 for value 90", () => {
    expect(readIntervalMinutes(doc("execution:\n  interval_minutes: 90\n"))).toBe(90);
  });

  it("returns default for a string value", () => {
    expect(readIntervalMinutes(doc('execution:\n  interval_minutes: "sixty"\n'))).toBe(60);
  });
});

// ---------- validateBranchNameInput ----------

describe("validateBranchNameInput", () => {
  it("returns true for a valid branch name", () => {
    expect(validateBranchNameInput("main")).toBe(true);
  });

  it("returns true for a branch name with slashes", () => {
    expect(validateBranchNameInput("release/1.0")).toBe(true);
  });

  it("returns an error string for empty input", () => {
    const result = validateBranchNameInput("");
    expect(typeof result).toBe("string");
  });

  it("returns an error string for input starting with '-'", () => {
    const result = validateBranchNameInput("-foo");
    expect(typeof result).toBe("string");
  });

  it("returns an error string for input containing '..'", () => {
    const result = validateBranchNameInput("foo..bar");
    expect(typeof result).toBe("string");
  });

  it("returns an error string for input ending with '.lock'", () => {
    const result = validateBranchNameInput("foo.lock");
    expect(typeof result).toBe("string");
  });
});

// ---------- validateIntegerInput ----------

describe("validateIntegerInput", () => {
  const spec = { min: 10, max: 100 };

  it("returns true for a value within range", () => {
    expect(validateIntegerInput("50", spec)).toBe(true);
  });

  it("returns true for the lower bound", () => {
    expect(validateIntegerInput("10", spec)).toBe(true);
  });

  it("returns true for the upper bound", () => {
    expect(validateIntegerInput("100", spec)).toBe(true);
  });

  it("returns an error string for a value below the lower bound", () => {
    const result = validateIntegerInput("9", spec);
    expect(typeof result).toBe("string");
  });

  it("returns an error string for a value above the upper bound", () => {
    const result = validateIntegerInput("101", spec);
    expect(typeof result).toBe("string");
  });

  it("returns an error string for a non-integer", () => {
    const result = validateIntegerInput("50.5", spec);
    expect(typeof result).toBe("string");
  });

  it("returns an error string for non-numeric input", () => {
    const result = validateIntegerInput("abc", spec);
    expect(typeof result).toBe("string");
  });
});
