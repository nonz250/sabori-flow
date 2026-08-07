import { readFileSync } from "node:fs";
import YAML from "yaml";

import type {
  AppConfig,
  Autonomy,
  LabelsConfig,
  PhaseLabels,
  RepositoryConfig,
  SpecPhaseLabels,
} from "./models.js";
import type { Language } from "../i18n/types.js";
import { CONFIG_YAML_PARSE_OPTIONS, DEFAULT_LABELS } from "./config.js";
import { getDefaultPriorityLabels } from "../utils/config-defaults.js";

// ---------- Public types ----------

export type ValueSource = "file" | "default";

export interface Sourced<T> {
  readonly value: T;
  readonly source: ValueSource;
}

export interface Compared<T> {
  readonly value: T;
  readonly matchesDefault: boolean;
}

export interface RepositoryInspection {
  readonly owner: string;
  readonly repo: string;
  readonly fullName: string;
  readonly localPath: string;
  readonly rawLocalPath: string | null;
  readonly defaultBranch: Sourced<string>;
  readonly autoImplAfterPlan: Sourced<boolean>;
  readonly labels: Compared<LabelsConfig>;
  readonly priorityLabels: Compared<readonly string[]>;
}

export interface ExecutionInspection {
  readonly maxParallel: Sourced<number>;
  readonly maxIssuesPerRepo: Sourced<number>;
  readonly autonomy: Sourced<Autonomy>;
  readonly intervalMinutes: Sourced<number>;
  readonly timeoutMinutes: Sourced<number>;
}

export interface ConfigInspection {
  readonly repositories: readonly RepositoryInspection[];
  readonly execution: ExecutionInspection;
  readonly language: Sourced<Language>;
}

// ---------- Public API ----------

export function readRawConfigDocument(configPath: string): unknown {
  try {
    const rawText = readFileSync(configPath, "utf-8");
    return YAML.parse(rawText, CONFIG_YAML_PARSE_OPTIONS) as unknown;
  } catch {
    return null;
  }
}

export function inspectConfig(
  config: AppConfig,
  rawDocument: unknown,
): ConfigInspection {
  const rawRecord = toRecord(rawDocument);
  const rawRepos = extractRawRepos(rawRecord);
  const rawExecution = extractRawExecution(rawRecord);

  const repositories = config.repositories.map((repo, index) =>
    inspectRepository(repo, matchRawRepo(repo, rawRepos?.[index] ?? null)),
  );

  return {
    repositories,
    execution: inspectExecution(config.execution, rawExecution),
    language: sourced(config.language, rawRecord, "language"),
  };
}

// ---------- Repository inspection ----------

function inspectRepository(
  repo: RepositoryConfig,
  rawEntry: Record<string, unknown> | null,
): RepositoryInspection {
  return {
    owner: repo.owner,
    repo: repo.repo,
    fullName: `${repo.owner}/${repo.repo}`,
    localPath: repo.localPath,
    rawLocalPath: extractRawLocalPath(rawEntry),
    defaultBranch: sourced(repo.defaultBranch, rawEntry, "default_branch"),
    autoImplAfterPlan: sourced(
      repo.autoImplAfterPlan,
      rawEntry,
      "auto_impl_after_plan",
    ),
    labels: compareLabels(repo.labels),
    priorityLabels: comparePriorityLabels(repo.priorityLabels),
  };
}

// parseRepositories() preserves array order 1:1, so index-based lookup is
// valid. Guard with an owner/repo check anyway: if a raw entry exists at the
// same index but names a different repo, treating it as a match would
// misattribute label/path provenance.
function matchRawRepo(
  repo: RepositoryConfig,
  rawEntry: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (rawEntry === null) return null;
  if (rawEntry["owner"] !== repo.owner || rawEntry["repo"] !== repo.repo) {
    return null;
  }
  return rawEntry;
}

function extractRawLocalPath(
  rawEntry: Record<string, unknown> | null,
): string | null {
  if (rawEntry === null) return null;
  const value = rawEntry["local_path"];
  return typeof value === "string" ? value : null;
}

// ---------- Execution inspection ----------

function inspectExecution(
  execution: AppConfig["execution"],
  rawExecution: Record<string, unknown> | null,
): ExecutionInspection {
  return {
    maxParallel: sourced(execution.maxParallel, rawExecution, "max_parallel"),
    maxIssuesPerRepo: sourced(
      execution.maxIssuesPerRepo,
      rawExecution,
      "max_issues_per_repo",
    ),
    autonomy: sourced(execution.autonomy, rawExecution, "autonomy"),
    intervalMinutes: sourced(
      execution.intervalMinutes,
      rawExecution,
      "interval_minutes",
    ),
    timeoutMinutes: sourced(
      execution.timeoutMinutes,
      rawExecution,
      "timeout_minutes",
    ),
  };
}

// ---------- Label comparison ----------

function phaseLabelsMatchDefault(
  actual: PhaseLabels,
  defaultPhase: PhaseLabels,
): boolean {
  return (
    actual.trigger === defaultPhase.trigger &&
    actual.inProgress === defaultPhase.inProgress &&
    actual.done === defaultPhase.done &&
    actual.failed === defaultPhase.failed
  );
}

function specLabelsMatchDefault(
  actual: SpecPhaseLabels,
  defaultPhase: SpecPhaseLabels,
): boolean {
  return (
    phaseLabelsMatchDefault(actual, defaultPhase) &&
    actual.review === defaultPhase.review &&
    actual.approved === defaultPhase.approved &&
    actual.needsHuman === defaultPhase.needsHuman
  );
}

function compareLabels(labels: LabelsConfig): Compared<LabelsConfig> {
  const matchesDefault =
    specLabelsMatchDefault(labels.spec, DEFAULT_LABELS.spec) &&
    phaseLabelsMatchDefault(labels.plan, DEFAULT_LABELS.plan) &&
    phaseLabelsMatchDefault(labels.impl, DEFAULT_LABELS.impl);
  return { value: labels, matchesDefault };
}

function comparePriorityLabels(
  labels: readonly string[],
): Compared<readonly string[]> {
  const defaults = getDefaultPriorityLabels();
  const matchesDefault =
    labels.length === defaults.length &&
    labels.every((label, i) => label === defaults[i]);
  return { value: labels, matchesDefault };
}

// ---------- Helpers ----------

function sourced<T>(
  value: T,
  rawRecord: Record<string, unknown> | null,
  key: string,
): Sourced<T> {
  // Fallback: when raw document is unavailable (e.g. concurrent edit between
  // loadConfig and readRawConfigDocument), treat all values as defaults.
  // Acceptable for a read-only display command.
  if (rawRecord === null) {
    return { value, source: "default" };
  }
  // A key written with no value (e.g. `language:`) parses to null, and the
  // corresponding parser falls back to its default the same as an absent
  // key, so provenance must follow suit. `!== null` (not a falsy check)
  // keeps legitimate values like `false` or `0` classified as "file".
  const isWritten = key in rawRecord && rawRecord[key] !== null;
  const source: ValueSource = isWritten ? "file" : "default";
  return { value, source };
}

function toRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractRawRepos(
  rawRecord: Record<string, unknown> | null,
): (Record<string, unknown> | null)[] | null {
  if (rawRecord === null) return null;
  const repos = rawRecord["repositories"];
  if (!Array.isArray(repos)) return null;

  return repos.map((entry: unknown) => {
    if (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry)
    ) {
      const record = entry as Record<string, unknown>;
      if (
        typeof record["owner"] === "string" &&
        typeof record["repo"] === "string"
      ) {
        return record;
      }
    }
    // Fallback: raw entry is malformed; treat as absent
    return null;
  });
}

function extractRawExecution(
  rawRecord: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (rawRecord === null) return null;
  return toRecord(rawRecord["execution"]);
}
