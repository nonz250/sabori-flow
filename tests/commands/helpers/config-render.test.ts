import { describe, it, expect } from "vitest";

import { renderConfigInspection } from "../../../src/commands/helpers/config-render.js";
import type {
  ConfigInspection,
  RepositoryInspection,
  ExecutionInspection,
  Sourced,
  Compared,
  ValueSource,
} from "../../../src/worker/config-inspect.js";
import type { LabelsConfig, Autonomy } from "../../../src/worker/models.js";
import type { Language } from "../../../src/i18n/types.js";

// ---------- Helpers ----------

function s<T>(value: T, source: ValueSource = "default"): Sourced<T> {
  return { value, source };
}

function c<T>(value: T, matchesDefault = true): Compared<T> {
  return { value, matchesDefault };
}

const DEFAULT_LABELS: LabelsConfig = {
  spec: {
    trigger: "ai/spec",
    inProgress: "ai/spec/in-progress",
    done: "ai/spec/done",
    failed: "ai/spec/failed",
    review: "ai/spec/review",
    approved: "ai/spec/approved",
    needsHuman: "ai/spec/needs-human",
  },
  plan: {
    trigger: "ai/plan",
    inProgress: "ai/plan/in-progress",
    done: "ai/plan/done",
    failed: "ai/plan/failed",
  },
  impl: {
    trigger: "ai/impl",
    inProgress: "ai/impl/in-progress",
    done: "ai/impl/done",
    failed: "ai/impl/failed",
  },
};

const CUSTOM_LABELS: LabelsConfig = {
  spec: {
    trigger: "my/spec",
    inProgress: "my/spec:wip",
    done: "my/spec:ok",
    failed: "my/spec:ng",
    review: "my/spec:review",
    approved: "my/spec:approved",
    needsHuman: "my/spec:human",
  },
  plan: {
    trigger: "my/plan",
    inProgress: "my/plan:wip",
    done: "my/plan:ok",
    failed: "my/plan:ng",
  },
  impl: {
    trigger: "my/impl",
    inProgress: "my/impl:wip",
    done: "my/impl:ok",
    failed: "my/impl:ng",
  },
};

function makeRepoInspection(
  overrides?: Partial<RepositoryInspection>,
): RepositoryInspection {
  return {
    owner: "acme",
    repo: "app",
    fullName: "acme/app",
    localPath: "/home/user/app",
    rawLocalPath: null,
    defaultBranch: s("main"),
    autoImplAfterPlan: s(false),
    labels: c(DEFAULT_LABELS),
    priorityLabels: c<readonly string[]>(["priority:high", "priority:low"]),
    ...overrides,
  };
}

function makeExecInspection(
  overrides?: Partial<ExecutionInspection>,
): ExecutionInspection {
  return {
    maxParallel: s(1),
    maxIssuesPerRepo: s(1),
    autonomy: s<Autonomy>("interactive"),
    intervalMinutes: s(60),
    timeoutMinutes: s(60),
    ...overrides,
  };
}

function makeInspection(overrides?: {
  repositories?: RepositoryInspection[];
  execution?: ExecutionInspection;
  language?: Sourced<Language>;
}): ConfigInspection {
  return {
    repositories: overrides?.repositories ?? [makeRepoInspection()],
    execution: overrides?.execution ?? makeExecInspection(),
    language: overrides?.language ?? s<Language>("ja"),
  };
}

// ---------- Tests: compact display ----------

describe("renderConfigInspection - compact display", () => {
  it("shows header line with repository count", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection(),
        makeRepoInspection({
          owner: "org2",
          repo: "repo2",
          fullName: "org2/repo2",
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    expect(lines[0]).toBe("repositories (2)");
  });

  it("produces header + one data row per repository", () => {
    const repos = [
      makeRepoInspection(),
      makeRepoInspection({
        owner: "org2",
        repo: "repo2",
        fullName: "org2/repo2",
        localPath: "/path/b",
      }),
    ];
    const inspection = makeInspection({ repositories: repos });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    // First line is section header, next is column headers, then 2 data rows
    expect(lines[0]).toBe("repositories (2)");
    expect(lines[1]).toContain("REPOSITORY");
    expect(lines[2]).toContain("acme/app");
    expect(lines[3]).toContain("org2/repo2");
  });
});

// ---------- Tests: column alignment ----------

describe("renderConfigInspection - column alignment", () => {
  it("columns align to the longest value with exact spacing", () => {
    const inspection = makeInspection({
      repositories: [makeRepoInspection()],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    // Column widths: REPOSITORY(10 vs 8)=10, BRANCH(6 vs 5)=6, AUTO_IMPL(9 vs 6)=9,
    // LABELS(6 vs 7)=7, PRIORITY(8 vs 7)=8, LOCAL_PATH=last
    // Each non-last column padded to width+2
    expect(lines[1]).toBe(
      "REPOSITORY  BRANCH  AUTO_IMPL  LABELS   PRIORITY  LOCAL_PATH",
    );
    expect(lines[2]).toBe(
      "acme/app    main*   false*     default  default   /home/user/app",
    );
  });

  it("column order is REPOSITORY, BRANCH, AUTO_IMPL, LABELS, PRIORITY, LOCAL_PATH", () => {
    const inspection = makeInspection({
      repositories: [makeRepoInspection()],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const headers = lines[1].trim().split(/\s+/);
    expect(headers).toEqual([
      "REPOSITORY",
      "BRANCH",
      "AUTO_IMPL",
      "LABELS",
      "PRIORITY",
      "LOCAL_PATH",
    ]);
  });
});

// ---------- Tests: default marker (*) ----------

describe("renderConfigInspection - default marker", () => {
  it("source 'default' values get * suffix in defaultBranch and autoImplAfterPlan", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          defaultBranch: s("main"),
          autoImplAfterPlan: s(false),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    expect(lines[2]).toContain("main*");
    expect(lines[2]).toContain("false*");
  });

  it("source 'file' values have no * suffix", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          defaultBranch: s("develop", "file"),
          autoImplAfterPlan: s(true, "file"),
        }),
      ],
      execution: makeExecInspection({
        maxParallel: s(4, "file"),
        maxIssuesPerRepo: s(2, "file"),
        autonomy: s<Autonomy>("full", "file"),
        intervalMinutes: s(30, "file"),
        timeoutMinutes: s(120, "file"),
      }),
      language: s<Language>("en", "file"),
    });

    const { lines, hasDefaultValues } = renderConfigInspection(inspection, {
      verbose: false,
    });

    expect(hasDefaultValues).toBe(false);
    for (const line of lines) {
      expect(line).not.toContain("*");
    }
  });

  it("labels and priority columns show 'default' or 'custom', not *", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          labels: c(DEFAULT_LABELS, true),
          priorityLabels: c<readonly string[]>(
            ["priority:high", "priority:low"],
            true,
          ),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const dataRow = lines[2];
    expect(dataRow).toContain("default");
    // Ensure labels/priority columns don't get * (they show default/custom text)
    const cols = dataRow.split(/\s+/);
    const labelsCol = cols[3];
    const priorityCol = cols[4];
    expect(labelsCol).toBe("default");
    expect(priorityCol).toBe("default");
  });

  it("custom labels column shows 'custom'", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          labels: c(CUSTOM_LABELS, false),
          priorityLabels: c<readonly string[]>(["custom:high"], false),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const dataRow = lines[2];
    const cols = dataRow.split(/\s+/);
    expect(cols[3]).toBe("custom");
    expect(cols[4]).toBe("custom");
  });

  it("execution default values get * suffix", () => {
    const inspection = makeInspection();

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const execSection = lines.join("\n");
    expect(execSection).toContain("1*");
    expect(execSection).toContain("interactive*");
    expect(execSection).toContain("60*");
  });

  it("language default value gets * suffix", () => {
    const inspection = makeInspection({ language: s<Language>("ja") });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain("ja*");
  });
});

// ---------- Tests: hasDefaultValues ----------

describe("renderConfigInspection - hasDefaultValues", () => {
  it("all file-specified produces hasDefaultValues === false", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          defaultBranch: s("develop", "file"),
          autoImplAfterPlan: s(true, "file"),
        }),
      ],
      execution: makeExecInspection({
        maxParallel: s(4, "file"),
        maxIssuesPerRepo: s(2, "file"),
        autonomy: s<Autonomy>("full", "file"),
        intervalMinutes: s(30, "file"),
        timeoutMinutes: s(120, "file"),
      }),
      language: s<Language>("en", "file"),
    });

    const { hasDefaultValues } = renderConfigInspection(inspection, {
      verbose: false,
    });

    expect(hasDefaultValues).toBe(false);
  });

  it("any default-sourced field produces hasDefaultValues === true", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ defaultBranch: s("main") }),
      ],
      execution: makeExecInspection({
        maxParallel: s(1, "file"),
        maxIssuesPerRepo: s(1, "file"),
        autonomy: s<Autonomy>("interactive", "file"),
        intervalMinutes: s(60, "file"),
        timeoutMinutes: s(60, "file"),
      }),
      language: s<Language>("ja", "file"),
    });

    const { hasDefaultValues } = renderConfigInspection(inspection, {
      verbose: false,
    });

    expect(hasDefaultValues).toBe(true);
  });
});

// ---------- Tests: label detail sections ----------

describe("renderConfigInspection - label detail sections", () => {
  it("custom labels repo shows detail block without verbose", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ labels: c(CUSTOM_LABELS, false) }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const joined = lines.join("\n");
    expect(joined).toContain("acme/app labels");
    expect(joined).toContain("plan.trigger");
    expect(joined).toContain("my/plan");
  });

  it("label detail block lists every spec, plan and impl key in config.yml order", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ labels: c(CUSTOM_LABELS, false) }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const start = lines.indexOf("acme/app labels");
    const block = lines.slice(start + 1, start + 16);
    expect(block.map((line) => line.trim().split(/\s+/)[0])).toEqual([
      "spec.trigger",
      "spec.in_progress",
      "spec.done",
      "spec.failed",
      "spec.review",
      "spec.approved",
      "spec.needs_human",
      "plan.trigger",
      "plan.in_progress",
      "plan.done",
      "plan.failed",
      "impl.trigger",
      "impl.in_progress",
      "impl.done",
      "impl.failed",
    ]);
    expect(block[6]).toContain("my/spec:human");
  });

  it("default labels repo does not show detail block without verbose", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ labels: c(DEFAULT_LABELS, true) }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const joined = lines.join("\n");
    expect(joined).not.toContain("acme/app labels");
  });

  it("verbose: true shows label detail for all repos", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ labels: c(DEFAULT_LABELS, true) }),
        makeRepoInspection({
          owner: "org2",
          repo: "repo2",
          fullName: "org2/repo2",
          labels: c(DEFAULT_LABELS, true),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    const joined = lines.join("\n");
    expect(joined).toContain("acme/app labels");
    expect(joined).toContain("org2/repo2 labels");
  });

  it("custom priority_labels repo shows detail block without verbose", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          priorityLabels: c<readonly string[]>(["custom:urgent"], false),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const joined = lines.join("\n");
    expect(joined).toContain("acme/app priority_labels");
    expect(joined).toContain("custom:urgent");
  });

  it("default priority_labels repo does not show detail block without verbose", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          priorityLabels: c<readonly string[]>(
            ["priority:high", "priority:low"],
            true,
          ),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const joined = lines.join("\n");
    expect(joined).not.toContain("priority_labels");
  });

  it("verbose: true shows priority_labels detail for all repos", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          priorityLabels: c<readonly string[]>(
            ["priority:high", "priority:low"],
            true,
          ),
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    const joined = lines.join("\n");
    expect(joined).toContain("acme/app priority_labels");
  });
});

// ---------- Tests: local_path sections ----------

describe("renderConfigInspection - local_path sections", () => {
  it("verbose: true with rawLocalPath !== localPath shows resolution block", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          rawLocalPath: "~/projects/app",
          localPath: "/home/user/projects/app",
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    const joined = lines.join("\n");
    expect(joined).toContain("acme/app local_path");
    expect(joined).toContain("~/projects/app");
    expect(joined).toContain("/home/user/projects/app");
  });

  it("verbose: true with rawLocalPath === localPath does not show resolution block", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          rawLocalPath: "/home/user/app",
          localPath: "/home/user/app",
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    const joined = lines.join("\n");
    expect(joined).not.toContain("local_path\n");
    expect(joined).not.toContain("acme/app local_path");
  });

  it("verbose: true with rawLocalPath === null does not show resolution block", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ rawLocalPath: null }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    const joined = lines.join("\n");
    expect(joined).not.toContain("acme/app local_path");
  });

  it("verbose: false never shows resolution block even when paths differ", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          rawLocalPath: "~/projects/app",
          localPath: "/home/user/projects/app",
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const joined = lines.join("\n");
    expect(joined).not.toContain("acme/app local_path");
  });
});

// ---------- Tests: execution section ----------

describe("renderConfigInspection - execution section", () => {
  it("items appear in order: max_parallel, max_issues_per_repo, autonomy, interval_minutes, timeout_minutes", () => {
    const inspection = makeInspection();

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    const execStart = lines.indexOf("execution");
    expect(execStart).toBeGreaterThan(-1);

    const execLines = lines.slice(execStart + 1, execStart + 6);
    expect(execLines[0]).toContain("max_parallel");
    expect(execLines[1]).toContain("max_issues_per_repo");
    expect(execLines[2]).toContain("autonomy");
    expect(execLines[3]).toContain("interval_minutes");
    expect(execLines[4]).toContain("timeout_minutes");
  });
});

// ---------- Tests: output format ----------

describe("renderConfigInspection - output format", () => {
  it("contains no ANSI escape sequences", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({ labels: c(CUSTOM_LABELS, false) }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    for (const line of lines) {
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  it("last line is not empty", () => {
    const inspection = makeInspection();

    const { lines } = renderConfigInspection(inspection, { verbose: false });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[lines.length - 1]).not.toBe("");
  });

  it("last line is not empty with verbose: true", () => {
    const inspection = makeInspection({
      repositories: [
        makeRepoInspection({
          labels: c(CUSTOM_LABELS, false),
          rawLocalPath: "~/app",
          localPath: "/home/user/app",
        }),
      ],
    });

    const { lines } = renderConfigInspection(inspection, { verbose: true });

    expect(lines[lines.length - 1]).not.toBe("");
  });
});
