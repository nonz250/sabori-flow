import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  applyChanges,
  collectFields,
  fromText,
  planChanges,
  readIntervalMinutes,
  readSchemaVersion,
  toText,
  validateFieldText,
  type ConfigField,
  type EvaluatedField,
  type FieldAnswer,
} from "../../../src/commands/helpers/config-fields.js";

// ---------- Helpers ----------

const EXISTING_DIR = mkdtempSync(join(tmpdir(), "config-fields-"));
const MISSING_DIR = join(EXISTING_DIR, "does-not-exist");

function doc(yaml: string) {
  return YAML.parseDocument(yaml);
}

function minimalConfig(localPath = EXISTING_DIR): string {
  return `\
repositories:
  - owner: acme
    repo: app
    local_path: ${localPath}
    priority_labels: []
`;
}

function collect(yaml: string, repo?: string): readonly EvaluatedField[] {
  const result = collectFields(doc(yaml), repo === undefined ? {} : { repo });
  if (!result.ok) {
    throw new Error(`unexpected failure: ${result.failure.kind}`);
  }
  return result.fields;
}

function find(fields: readonly EvaluatedField[], id: string): EvaluatedField {
  const found = fields.find((f) => f.field.id === id);
  if (found === undefined) {
    throw new Error(`field ${id} not found`);
  }
  return found;
}

function fieldOf(fields: readonly EvaluatedField[], id: string): ConfigField {
  return find(fields, id).field;
}

function answers(
  fields: readonly EvaluatedField[],
  entries: Record<string, FieldAnswer>,
): Map<ConfigField, FieldAnswer> {
  return new Map(Object.entries(entries).map(([id, a]) => [fieldOf(fields, id), a]));
}

// ---------- collectFields: coverage ----------

describe("collectFields - which keys are reviewed", () => {
  it("covers every root and repository key, labels included", () => {
    const ids = collect(minimalConfig()).map((f) => f.field.id);
    expect(ids).toEqual([
      "language",
      "execution.max_parallel",
      "execution.max_issues_per_repo",
      "execution.agent",
      "execution.autonomy",
      "execution.interval_minutes",
      "execution.timeout_minutes",
      "repositories[0].owner",
      "repositories[0].repo",
      "repositories[0].local_path",
      "repositories[0].default_branch",
      "repositories[0].auto_impl_after_plan",
      "repositories[0].priority_labels",
      "repositories[0].labels.spec.trigger",
      "repositories[0].labels.spec.in_progress",
      "repositories[0].labels.spec.done",
      "repositories[0].labels.spec.failed",
      "repositories[0].labels.spec.review",
      "repositories[0].labels.spec.approved",
      "repositories[0].labels.spec.needs_human",
      "repositories[0].labels.plan.trigger",
      "repositories[0].labels.plan.in_progress",
      "repositories[0].labels.plan.done",
      "repositories[0].labels.plan.failed",
      "repositories[0].labels.impl.trigger",
      "repositories[0].labels.impl.in_progress",
      "repositories[0].labels.impl.done",
      "repositories[0].labels.impl.failed",
      "repositories[0].labels.review.trigger",
      "repositories[0].labels.review.in_progress",
      "repositories[0].labels.review.done",
      "repositories[0].labels.review.failed",
    ]);
  });

  it("collects each repository in order", () => {
    const yaml = `${minimalConfig()}  - owner: acme
    repo: web
    local_path: ${EXISTING_DIR}
    priority_labels: []
`;
    const ids = collect(yaml).map((f) => f.field.id);
    expect(ids).toContain("repositories[0].owner");
    expect(ids).toContain("repositories[1].labels.impl.failed");
    expect(ids.indexOf("repositories[0].labels.impl.failed")).toBeLessThan(
      ids.indexOf("repositories[1].owner"),
    );
  });
});

// ---------- collectFields: --repo ----------

describe("collectFields - limited to one repository", () => {
  const twoRepos = `${minimalConfig()}  - owner: acme
    repo: web
    local_path: ${EXISTING_DIR}
    priority_labels: []
`;

  it("returns only the named repository's keys, without root keys", () => {
    const ids = collect(twoRepos, "acme/web").map((f) => f.field.id);
    expect(ids.every((id) => id.startsWith("repositories[1]."))).toBe(true);
    expect(ids).toContain("repositories[1].labels.spec.needs_human");
    expect(ids).not.toContain("language");
  });

  it("fails when no repository matches", () => {
    const result = collectFields(doc(twoRepos), { repo: "acme/missing" });
    expect(result).toEqual({
      ok: false,
      failure: { kind: "repo-not-found", repo: "acme/missing" },
    });
  });

  it("does not match on owner or repo alone", () => {
    const result = collectFields(doc(twoRepos), { repo: "web" });
    expect(result.ok).toBe(false);
  });
});

// ---------- collectFields: states ----------

describe("collectFields - state of each key", () => {
  it("reports omitted optional keys as unset", () => {
    const fields = collect(minimalConfig());
    expect(find(fields, "execution.interval_minutes").state).toEqual({ kind: "unset" });
    expect(find(fields, "repositories[0].default_branch").state).toEqual({ kind: "unset" });
    expect(find(fields, "repositories[0].labels.plan.trigger").state).toEqual({ kind: "unset" });
  });

  it("reports valid keys with their value", () => {
    const yaml = `${minimalConfig()}execution:
  interval_minutes: 30
`;
    expect(find(collect(yaml), "execution.interval_minutes").state).toEqual({
      kind: "valid",
      value: 30,
    });
  });

  it("accepts the range boundaries", () => {
    const low = `${minimalConfig()}execution:\n  interval_minutes: 10\n`;
    const high = `${minimalConfig()}execution:\n  interval_minutes: 1440\n`;
    expect(find(collect(low), "execution.interval_minutes").state.kind).toBe("valid");
    expect(find(collect(high), "execution.interval_minutes").state.kind).toBe("valid");
  });

  it("reports out-of-range values as invalid with loadConfig's reason", () => {
    const yaml = `${minimalConfig()}execution:\n  interval_minutes: 9\n`;
    expect(find(collect(yaml), "execution.interval_minutes").state).toEqual({
      kind: "invalid",
      value: 9,
      reason: "execution.interval_minutes: must be >= 10, got 9",
    });
  });

  it("reports a value of the wrong type as invalid", () => {
    const yaml = `${minimalConfig()}execution:\n  max_parallel: "two"\n`;
    expect(find(collect(yaml), "execution.max_parallel").state.kind).toBe("invalid");
  });

  it("reports a missing required key as invalid", () => {
    const yaml = `\
repositories:
  - owner: acme
    repo: app
    local_path: ${EXISTING_DIR}
`;
    expect(find(collect(yaml), "repositories[0].priority_labels").state).toEqual({
      kind: "invalid",
      value: undefined,
      reason: "repositories[0].priority_labels: required",
    });
  });

  it("reports a local_path that does not exist as invalid", () => {
    const state = find(collect(minimalConfig(MISSING_DIR)), "repositories[0].local_path").state;
    expect(state.kind).toBe("invalid");
  });

  it("treats a single agent and a one-element list as the same value", () => {
    const asString = `${minimalConfig()}execution:\n  agent: claude\n`;
    const asList = `${minimalConfig()}execution:\n  agent: [claude]\n`;
    expect(find(collect(asString), "execution.agent").state).toEqual({ kind: "valid", value: "claude" });
    expect(find(collect(asList), "execution.agent").state).toEqual({ kind: "valid", value: "claude" });
  });

  it("keeps a priority list of agents as a list", () => {
    const yaml = `${minimalConfig()}execution:\n  agent: [codex, claude]\n`;
    expect(find(collect(yaml), "execution.agent").state).toEqual({
      kind: "valid",
      value: ["codex", "claude"],
    });
  });

  it("requires every key of a label phase once the phase exists", () => {
    const yaml = `${minimalConfig()}    labels:
      plan:
        trigger: my/plan
`;
    const fields = collect(yaml);
    expect(find(fields, "repositories[0].labels.plan.trigger").state).toEqual({
      kind: "valid",
      value: "my/plan",
    });
    expect(find(fields, "repositories[0].labels.plan.done").state.kind).toBe("invalid");
    expect(find(fields, "repositories[0].labels.impl.done").state).toEqual({ kind: "unset" });
  });

  it("offers the ai/review defaults for omitted review labels", () => {
    const field = find(collect(minimalConfig()), "repositories[0].labels.review.in_progress");
    expect(field.state).toEqual({ kind: "unset" });
    expect(field.field.defaultValue).toBe("ai/review/in-progress");
  });

  it("treats execution: null as an omitted section", () => {
    const yaml = `${minimalConfig()}execution:\n`;
    expect(find(collect(yaml), "execution.timeout_minutes").state).toEqual({ kind: "unset" });
  });
});

// ---------- collectFields: review findings ----------

describe("collectFields - aliases and suggested values", () => {
  it("resolves YAML aliases the way loadConfig does", () => {
    const yaml = `\
x-branch: &br develop
x-labels: &pl [priority:high]
repositories:
  - owner: acme
    repo: app
    local_path: ${EXISTING_DIR}
    default_branch: *br
    priority_labels: *pl
`;
    const fields = collect(yaml);
    expect(find(fields, "repositories[0].default_branch").state).toEqual({ kind: "valid", value: "develop" });
    expect(find(fields, "repositories[0].priority_labels").state).toEqual({
      kind: "valid",
      value: ["priority:high"],
    });
  });

  it("suggests the default priority labels when priority_labels is missing", () => {
    const yaml = minimalConfig().replace("    priority_labels: []\n", "");
    expect(fieldOf(collect(yaml), "repositories[0].priority_labels").defaultValue).toEqual([
      "priority:high",
      "priority:low",
    ]);
  });

  it("suggests the default label for a key missing from an existing phase", () => {
    const yaml = `${minimalConfig()}    labels:\n      plan:\n        trigger: my/plan\n`;
    expect(fieldOf(collect(yaml), "repositories[0].labels.plan.done").defaultValue).toBe("ai/plan/done");
  });

  it("has a default for every label key", () => {
    const labelFields = collect(minimalConfig()).filter((f) => f.field.group !== null);
    expect(labelFields).toHaveLength(19);
    expect(labelFields.every((f) => typeof f.field.defaultValue === "string")).toBe(true);
    expect(fieldOf(labelFields, "repositories[0].labels.spec.needs_human").defaultValue).toBe(
      "ai/spec/needs-human",
    );
  });
});

describe("collectFields - --repo matching", () => {
  const yaml = `${minimalConfig()}  - owner: acme
    repo: app
    local_path: ${EXISTING_DIR}
    priority_labels: []
  - owner: acme
    repo: web
    local_path: ${EXISTING_DIR}
    priority_labels: []
`;

  it("ignores case, as GitHub does", () => {
    const ids = collect(yaml, "ACME/Web").map((f) => f.field.id);
    expect(ids).toContain("repositories[2].owner");
  });

  it("reviews every entry for the same repository", () => {
    const ids = collect(yaml, "acme/app").map((f) => f.field.id);
    expect(ids).toContain("repositories[0].owner");
    expect(ids).toContain("repositories[1].owner");
    expect(ids).not.toContain("repositories[2].owner");
  });
});

// ---------- collectFields: structural failures ----------

describe("collectFields - structural failures", () => {
  it("fails when the top level is not a mapping", () => {
    expect(collectFields(doc("- a\n"))).toEqual({ ok: false, failure: { kind: "not-a-mapping" } });
  });

  it("fails when repositories is missing", () => {
    expect(collectFields(doc("language: ja\n"))).toEqual({
      ok: false,
      failure: { kind: "repositories-invalid" },
    });
  });

  it("fails when a repository entry is not a mapping", () => {
    expect(collectFields(doc("repositories:\n  - acme/app\n"))).toEqual({
      ok: false,
      failure: { kind: "repositories-invalid" },
    });
  });

  it("fails when execution is not a mapping", () => {
    const yaml = `${minimalConfig()}execution: [1]\n`;
    expect(collectFields(doc(yaml))).toEqual({
      ok: false,
      failure: { kind: "section-invalid", path: "execution" },
    });
  });

  it("fails when labels is not a mapping", () => {
    const yaml = `${minimalConfig()}    labels: ai\n`;
    expect(collectFields(doc(yaml))).toEqual({
      ok: false,
      failure: { kind: "section-invalid", path: "repositories[0].labels" },
    });
  });

  it("fails when a label phase is null", () => {
    const yaml = `${minimalConfig()}    labels:\n      plan:\n`;
    expect(collectFields(doc(yaml))).toEqual({
      ok: false,
      failure: { kind: "section-invalid", path: "repositories[0].labels.plan" },
    });
  });

  it("ignores a broken execution section when limited to one repository", () => {
    const yaml = `${minimalConfig()}execution: [1]\n`;
    expect(collectFields(doc(yaml), { repo: "acme/app" }).ok).toBe(true);
  });
});

// ---------- Text conversion ----------

describe("toText / fromText", () => {
  const fields = collect(minimalConfig());

  it("round-trips a list through comma-separated text", () => {
    const field = fieldOf(fields, "repositories[0].priority_labels");
    const text = toText(field, ["priority:high", "priority:low"]);
    expect(text).toBe("priority:high, priority:low");
    expect(fromText(field, text)).toEqual(["priority:high", "priority:low"]);
  });

  it("drops empty list items", () => {
    const field = fieldOf(fields, "repositories[0].priority_labels");
    expect(fromText(field, " a , ,b ")).toEqual(["a", "b"]);
  });

  it("parses a comma-separated agent list and collapses a single agent", () => {
    const field = fieldOf(fields, "execution.agent");
    expect(fromText(field, "codex, claude")).toEqual(["codex", "claude"]);
    expect(fromText(field, "codex")).toBe("codex");
  });

  it("parses integers", () => {
    expect(fromText(fieldOf(fields, "execution.timeout_minutes"), " 240 ")).toBe(240);
  });

  it("parses booleans", () => {
    expect(fromText(fieldOf(fields, "repositories[0].auto_impl_after_plan"), "true")).toBe(true);
  });
});

describe("validateFieldText", () => {
  const fields = collect(minimalConfig());

  it("accepts a valid value", () => {
    expect(validateFieldText(fieldOf(fields, "execution.max_parallel"), "10")).toBe(true);
  });

  it("rejects a value just outside the range", () => {
    expect(validateFieldText(fieldOf(fields, "execution.max_parallel"), "11")).toBe(
      "execution.max_parallel: must be <= 10, got 11",
    );
  });

  it("rejects text that is not an integer", () => {
    expect(validateFieldText(fieldOf(fields, "execution.max_parallel"), "1.5")).toBe(
      "execution.max_parallel: must be an integer, got '1.5'",
    );
  });

  it("rejects an unknown agent", () => {
    expect(validateFieldText(fieldOf(fields, "execution.agent"), "claude, gemini")).not.toBe(true);
  });

  it("rejects a duplicated agent", () => {
    expect(validateFieldText(fieldOf(fields, "execution.agent"), "claude, claude")).not.toBe(true);
  });

  it("rejects a branch name git would refuse", () => {
    expect(validateFieldText(fieldOf(fields, "repositories[0].default_branch"), "feature/.x")).not.toBe(true);
  });

  it("rejects a local_path that does not exist", () => {
    expect(validateFieldText(fieldOf(fields, "repositories[0].local_path"), MISSING_DIR)).not.toBe(true);
  });

  it("rejects a label starting with a hyphen", () => {
    expect(validateFieldText(fieldOf(fields, "repositories[0].labels.plan.trigger"), "-x")).not.toBe(true);
  });
});

// ---------- planChanges ----------

describe("planChanges", () => {
  const yaml = `${minimalConfig()}execution:\n  interval_minutes: 30\n`;
  const fields = collect(yaml);

  it("plans nothing when every answer keeps the current state", () => {
    expect(planChanges(fields, answers(fields, { language: { kind: "keep" } }))).toEqual([]);
  });

  it("does not treat re-entering the current value as a change", () => {
    const plan = planChanges(
      fields,
      answers(fields, { "execution.interval_minutes": { kind: "set", value: 30 } }),
    );
    expect(plan).toEqual([]);
  });

  it("plans an update of an existing value", () => {
    const plan = planChanges(
      fields,
      answers(fields, { "execution.interval_minutes": { kind: "set", value: 60 } }),
    );
    expect(plan).toEqual([
      { id: "execution.interval_minutes", path: ["execution", "interval_minutes"], before: 30, after: 60 },
    ]);
  });

  it("writes an omitted key even when the entered value equals its default", () => {
    const plan = planChanges(
      fields,
      answers(fields, { "execution.timeout_minutes": { kind: "set", value: 60 } }),
    );
    expect(plan).toEqual([
      { id: "execution.timeout_minutes", path: ["execution", "timeout_minutes"], before: undefined, after: 60 },
    ]);
  });

  it("fills the rest of an omitted label phase with defaults", () => {
    const plan = planChanges(
      fields,
      answers(fields, { "repositories[0].labels.plan.trigger": { kind: "set", value: "my/plan" } }),
    );
    expect(plan.map((c) => [c.id, c.after])).toEqual([
      ["repositories[0].labels.plan.trigger", "my/plan"],
      ["repositories[0].labels.plan.in_progress", "ai/plan/in-progress"],
      ["repositories[0].labels.plan.done", "ai/plan/done"],
      ["repositories[0].labels.plan.failed", "ai/plan/failed"],
    ]);
  });

  it("does not fill other label phases", () => {
    const plan = planChanges(
      fields,
      answers(fields, { "repositories[0].labels.plan.trigger": { kind: "set", value: "my/plan" } }),
    );
    expect(plan.some((c) => c.id.includes(".labels.impl."))).toBe(false);
  });
});

// ---------- applyChanges ----------

describe("applyChanges", () => {
  it("writes values while keeping comments and unknown keys", () => {
    const source = `# header\n${minimalConfig()}custom: kept # note\n`;
    const document = doc(source);
    applyChanges(document, [
      { id: "execution.agent", path: ["execution", "agent"], before: undefined, after: ["codex", "claude"] },
    ]);
    const out = document.toString();
    expect(out).toContain("# header");
    expect(out).toContain("custom: kept # note");
    expect(YAML.parse(out).execution.agent).toEqual(["codex", "claude"]);
  });

  it("writes into an execution section that is null", () => {
    const document = doc(`${minimalConfig()}execution:\n`);
    applyChanges(document, [
      { id: "execution.max_parallel", path: ["execution", "max_parallel"], before: undefined, after: 2 },
    ]);
    expect(YAML.parse(document.toString()).execution).toEqual({ max_parallel: 2 });
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
    expect(readIntervalMinutes(doc("repositories: []\n"))).toBe(10);
  });

  it("returns 60 for value 60", () => {
    expect(readIntervalMinutes(doc("execution:\n  interval_minutes: 60\n"))).toBe(60);
  });

  it("returns 90 for value 90", () => {
    expect(readIntervalMinutes(doc("execution:\n  interval_minutes: 90\n"))).toBe(90);
  });

  it("returns default for a string value", () => {
    expect(readIntervalMinutes(doc('execution:\n  interval_minutes: "sixty"\n'))).toBe(10);
  });
});
