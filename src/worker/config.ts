import { readFileSync, realpathSync } from "node:fs";
import YAML from "yaml";

import {
  Autonomy,
  Agent,
  type AppConfig,
  type ExecutionConfig,
  type RepositoryConfig,
  type LabelsConfig,
  type PhaseLabels,
  type SpecPhaseLabels,
} from "./models.js";
import { expandTilde } from "../utils/paths.js";
import { CONFIG_YAML_PARSE_OPTIONS } from "../utils/config-defaults.js";
import type { Language } from "../i18n/types.js";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "../i18n/types.js";

// ---------- Custom error ----------

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}

// ---------- Validation patterns ----------

const OWNER_REPO_PATTERN = /^[a-zA-Z0-9._-]+$/;
// Leading hyphen excluded: label names reach `gh label create <name>` as a
// positional argument, and a name like `--repo` would be read as a flag.
const LABEL_PATTERN = /^[a-zA-Z0-9./:_ ][a-zA-Z0-9./:_ -]*$/;
const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9._\/-]+$/;
// local_path is echoed verbatim in the `show` command and log output, so
// control characters are rejected here for display/log safety.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
export const DEFAULT_BRANCH_DEFAULT = "main";
export const PHASE_LABEL_KEYS = ["trigger", "in_progress", "done", "failed"] as const;
export const SPEC_LABEL_KEYS = [...PHASE_LABEL_KEYS, "review", "approved", "needs_human"] as const;

export const DEFAULT_LABELS: LabelsConfig = {
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
  review: {
    trigger: "ai/review",
    inProgress: "ai/review/in-progress",
    done: "ai/review/done",
    failed: "ai/review/failed",
  },
};

export const MAX_PARALLEL_MIN = 1;
export const MAX_PARALLEL_MAX = 10;
export const MAX_ISSUES_PER_REPO_MIN = 1;
export const MAX_ISSUES_PER_REPO_MAX = 20;

export const INTERVAL_MINUTES_MIN = 10;
export const INTERVAL_MINUTES_MAX = 1440;

const TIMEOUT_MINUTES_DEFAULT = 60;
export const TIMEOUT_MINUTES_MIN = 1;
export const TIMEOUT_MINUTES_MAX = 240;

// ---------- Public API ----------

/**
 * config.yml を読み込み、バリデーション後に AppConfig を返す。
 *
 * @throws {FileNotFoundError} 設定ファイルが存在しない場合
 * @throws {ConfigValidationError} 設定内容が不正な場合
 */
export function loadConfig(configPath: string): AppConfig {
  let rawText: string;
  try {
    rawText = readFileSync(configPath, "utf-8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    throw error;
  }

  let data: unknown;
  try {
    data = YAML.parse(rawText, CONFIG_YAML_PARSE_OPTIONS);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ConfigValidationError(`Failed to parse YAML: ${message}`);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ConfigValidationError("Config must be a YAML mapping");
  }

  const record = data as Record<string, unknown>;

  if (!("repositories" in record)) {
    throw new ConfigValidationError("'repositories' key is required");
  }

  const repositories = parseRepositories(record["repositories"]);
  const parsedExecution = parseExecution(
    "execution" in record ? record["execution"] : undefined,
  );

  const language = parseLanguage(
    "language" in record ? record["language"] : undefined,
  );

  // language is copied from AppConfig top-level into ExecutionConfig
  // so that processIssue can access it without needing the full AppConfig
  const execution: ExecutionConfig = { ...parsedExecution, language };

  return { language, repositories, execution };
}

// ---------- Internal parsers ----------

export function parseLanguage(raw: unknown): Language {
  if (raw === undefined || raw === null) {
    return DEFAULT_LANGUAGE;
  }
  if (typeof raw !== "string") {
    throw new ConfigValidationError(
      `'language' must be a string, got ${typeof raw}`,
    );
  }
  if (!SUPPORTED_LANGUAGES.includes(raw as Language)) {
    throw new ConfigValidationError(
      `'language' must be one of: ${SUPPORTED_LANGUAGES.join(", ")}; got '${raw}'`,
    );
  }
  return raw as Language;
}

function parseRepositories(raw: unknown): readonly RepositoryConfig[] {
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError("'repositories' must be a list");
  }

  if (raw.length === 0) {
    throw new ConfigValidationError(
      "'repositories' must have at least one entry",
    );
  }

  const configs: RepositoryConfig[] = [];

  for (let i = 0; i < raw.length; i++) {
    const prefix = `repositories[${i}]`;
    const entry = raw[i] as unknown;

    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ConfigValidationError(`${prefix}: must be a mapping`);
    }

    const record = entry as Record<string, unknown>;

    const owner = validateOwnerRepo(record, "owner", prefix);
    const repo = validateOwnerRepo(record, "repo", prefix);

    // local_path
    if (!("local_path" in record)) {
      throw new ConfigValidationError(`${prefix}: 'local_path' is required`);
    }

    const resolvedLocalPath = resolveLocalPath(
      record["local_path"],
      `${prefix}.local_path`,
    );

    // labels (optional — defaults to ai/* when omitted)
    let labels: LabelsConfig;
    if ("labels" in record) {
      const labelsRaw = record["labels"];
      if (
        labelsRaw === null ||
        typeof labelsRaw !== "object" ||
        Array.isArray(labelsRaw)
      ) {
        throw new ConfigValidationError(`${prefix}.labels: must be a mapping`);
      }

      const labelsRecord = labelsRaw as Record<string, unknown>;

      const spec = "spec" in labelsRecord
        ? parseSpecPhaseLabels(labelsRecord["spec"], `${prefix}.labels.spec`)
        : DEFAULT_LABELS.spec;
      const plan = "plan" in labelsRecord
        ? parsePhaseLabels(labelsRecord["plan"], `${prefix}.labels.plan`)
        : DEFAULT_LABELS.plan;
      const impl = "impl" in labelsRecord
        ? parsePhaseLabels(labelsRecord["impl"], `${prefix}.labels.impl`)
        : DEFAULT_LABELS.impl;
      const review = "review" in labelsRecord
        ? parsePhaseLabels(labelsRecord["review"], `${prefix}.labels.review`)
        : DEFAULT_LABELS.review;

      labels = { spec, plan, impl, review };
    } else {
      labels = DEFAULT_LABELS;
    }

    // priority_labels
    if (!("priority_labels" in record)) {
      throw new ConfigValidationError(
        `${prefix}: 'priority_labels' is required`,
      );
    }

    const priorityLabels = parsePriorityLabels(
      record["priority_labels"],
      `${prefix}.priority_labels`,
    );

    // auto_impl_after_plan (optional, default: false)
    let autoImplAfterPlan = false;
    if ("auto_impl_after_plan" in record) {
      autoImplAfterPlan = validateAutoImplAfterPlan(
        record["auto_impl_after_plan"],
        `${prefix}.auto_impl_after_plan`,
      );
    }

    // default_branch (optional, default: "main")
    let defaultBranch = DEFAULT_BRANCH_DEFAULT;
    if ("default_branch" in record) {
      defaultBranch = parseDefaultBranch(
        record["default_branch"],
        `${prefix}.default_branch`,
      );
    }

    configs.push({
      owner,
      repo,
      localPath: resolvedLocalPath,
      defaultBranch,
      labels,
      priorityLabels,
      autoImplAfterPlan,
    });
  }

  return configs;
}

function validateOwnerRepo(
  entry: Record<string, unknown>,
  key: string,
  prefix: string,
): string {
  if (!(key in entry)) {
    throw new ConfigValidationError(`${prefix}: '${key}' is required`);
  }

  return validateOwnerRepoValue(entry[key], `${prefix}.${key}`);
}

export function validateOwnerRepoValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    throw new ConfigValidationError(`${path}: must be a non-empty string`);
  }

  if (!OWNER_REPO_PATTERN.test(value)) {
    throw new ConfigValidationError(
      `${path}: invalid characters in '${value}' ` +
        `(must match ${OWNER_REPO_PATTERN.source})`,
    );
  }

  return value;
}

/** Returns the resolved real path; the path must exist on this machine. */
export function resolveLocalPath(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    throw new ConfigValidationError(`${path}: must be a non-empty string`);
  }

  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new ConfigValidationError(
      `${path}: must not contain control characters`,
    );
  }

  const localPath = expandTilde(value);

  if (!isAbsolutePath(localPath)) {
    throw new ConfigValidationError(
      `${path}: must be an absolute path, got '${localPath}'`,
    );
  }

  try {
    return realpathSync(localPath);
  } catch {
    throw new ConfigValidationError(
      `${path}: path does not exist: '${localPath}'`,
    );
  }
}

export function parsePriorityLabels(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigValidationError(`${path}: must be a list`);
  }

  return value.map((item: unknown, index: number) =>
    validateLabelName(item, `${path}[${index}]`),
  );
}

export function validateLabelName(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ConfigValidationError(`${path}: must be a string`);
  }

  if (!LABEL_PATTERN.test(value)) {
    throw new ConfigValidationError(
      `${path}: invalid characters in '${value}' ` +
        `(must match ${LABEL_PATTERN.source})`,
    );
  }

  return value;
}

export function validateAutoImplAfterPlan(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigValidationError(
      `${path}: must be a boolean, got ${typeof value}`,
    );
  }
  return value;
}

export function parseDefaultBranch(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    throw new ConfigValidationError(`${path}: must be a non-empty string`);
  }
  return validateBranchName(value, path);
}

function parsePhaseLabels(raw: unknown, phaseName: string): PhaseLabels {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(`${phaseName}: must be a mapping`);
  }

  const record = raw as Record<string, unknown>;
  const values: Record<string, string> = {};

  for (const key of PHASE_LABEL_KEYS) {
    if (!(key in record)) {
      throw new ConfigValidationError(
        `${phaseName}: '${key}' key is required`,
      );
    }

    values[key] = validateLabelName(record[key], `${phaseName}.${key}`);
  }

  return {
    trigger: values["trigger"],
    inProgress: values["in_progress"],
    done: values["done"],
    failed: values["failed"],
  };
}

function parseSpecPhaseLabels(raw: unknown, phaseName: string): SpecPhaseLabels {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(`${phaseName}: must be a mapping`);
  }

  const record = raw as Record<string, unknown>;
  const values: Record<string, string> = {};

  for (const key of SPEC_LABEL_KEYS) {
    if (!(key in record)) {
      throw new ConfigValidationError(
        `${phaseName}: '${key}' key is required`,
      );
    }

    values[key] = validateLabelName(record[key], `${phaseName}.${key}`);
  }

  return {
    trigger: values["trigger"],
    inProgress: values["in_progress"],
    done: values["done"],
    failed: values["failed"],
    review: values["review"],
    approved: values["approved"],
    needsHuman: values["needs_human"],
  };
}

function parseExecution(raw: unknown): Omit<ExecutionConfig, "language"> {
  if (raw === undefined || raw === null) {
    return {
      maxParallel: 1,
      maxIssuesPerRepo: 1,
      agents: [Agent.CLAUDE],
      autonomy: Autonomy.INTERACTIVE,
      intervalMinutes: 10,
      timeoutMinutes: TIMEOUT_MINUTES_DEFAULT,
    };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError("'execution' must be a mapping");
  }

  const record = raw as Record<string, unknown>;

  // max_parallel
  const rawMaxParallel =
    "max_parallel" in record ? record["max_parallel"] : 1;

  const maxParallel = validateIntegerInRange(
    rawMaxParallel,
    "execution.max_parallel",
    MAX_PARALLEL_MIN,
    MAX_PARALLEL_MAX,
  );

  // max_issues_per_repo
  const rawMaxIssuesPerRepo =
    "max_issues_per_repo" in record ? record["max_issues_per_repo"] : 1;

  const maxIssuesPerRepo = validateIntegerInRange(
    rawMaxIssuesPerRepo,
    "execution.max_issues_per_repo",
    MAX_ISSUES_PER_REPO_MIN,
    MAX_ISSUES_PER_REPO_MAX,
  );

  // agent
  const agents = parseAgents(
    "agent" in record ? record["agent"] : Agent.CLAUDE,
  );

  // autonomy
  const rawAutonomy =
    "autonomy" in record ? record["autonomy"] : Autonomy.INTERACTIVE;

  const autonomy = validateAutonomy(rawAutonomy, "execution.autonomy");

  // interval_minutes
  const rawIntervalMinutes =
    "interval_minutes" in record ? record["interval_minutes"] : 10;

  const intervalMinutes = validateIntegerInRange(
    rawIntervalMinutes,
    "execution.interval_minutes",
    INTERVAL_MINUTES_MIN,
    INTERVAL_MINUTES_MAX,
  );

  // timeout_minutes
  const rawTimeoutMinutes =
    "timeout_minutes" in record ? record["timeout_minutes"] : TIMEOUT_MINUTES_DEFAULT;

  const timeoutMinutes = validateIntegerInRange(
    rawTimeoutMinutes,
    "execution.timeout_minutes",
    TIMEOUT_MINUTES_MIN,
    TIMEOUT_MINUTES_MAX,
  );

  return {
    maxParallel,
    maxIssuesPerRepo,
    agents,
    autonomy,
    intervalMinutes,
    timeoutMinutes,
  };
}

export function validateIntegerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ConfigValidationError(
      `${path}: must be an integer, got ${typeof value}`,
    );
  }

  if (value < min) {
    throw new ConfigValidationError(`${path}: must be >= ${min}, got ${value}`);
  }

  if (value > max) {
    throw new ConfigValidationError(`${path}: must be <= ${max}, got ${value}`);
  }

  return value;
}

export function validateAutonomy(value: unknown, path: string): Autonomy {
  if (typeof value !== "string") {
    throw new ConfigValidationError(
      `${path}: must be a string, got ${typeof value}`,
    );
  }

  const validAutonomyValues = Object.values(Autonomy) as string[];
  if (!validAutonomyValues.includes(value)) {
    throw new ConfigValidationError(
      `${path}: must be one of: ${validAutonomyValues.join(", ")}; got '${value}'`,
    );
  }
  return value as Autonomy;
}

/**
 * A single agent name is shorthand for a one-element priority list, so
 * configs written before fallback existed keep their meaning.
 */
export function parseAgents(raw: unknown): readonly Agent[] {
  if (typeof raw === "string") {
    return [validateAgent(raw, "execution.agent")];
  }

  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      `execution.agent: must be a string or a list of strings, got ${typeof raw}`,
    );
  }

  if (raw.length === 0) {
    throw new ConfigValidationError("execution.agent: must not be an empty list");
  }

  const agents: Agent[] = [];
  raw.forEach((item: unknown, index: number) => {
    const prefix = `execution.agent[${index}]`;
    if (typeof item !== "string") {
      throw new ConfigValidationError(
        `${prefix}: must be a string, got ${typeof item}`,
      );
    }
    const agent = validateAgent(item, prefix);
    if (agents.includes(agent)) {
      throw new ConfigValidationError(`${prefix}: duplicate agent '${agent}'`);
    }
    agents.push(agent);
  });
  return agents;
}

function validateAgent(value: string, prefix: string): Agent {
  const validAgentValues = Object.values(Agent) as string[];
  if (!validAgentValues.includes(value)) {
    throw new ConfigValidationError(
      `${prefix}: must be one of: ${validAgentValues.join(", ")}; got '${value}'`,
    );
  }
  return value as Agent;
}

// ---------- Helpers ----------

export function validateBranchName(value: string, prefix: string): string {
  if (!BRANCH_NAME_PATTERN.test(value)) {
    throw new ConfigValidationError(
      `${prefix}: invalid characters in '${value}'`,
    );
  }
  if (value.startsWith("-")) {
    throw new ConfigValidationError(
      `${prefix}: must not start with '-'`,
    );
  }
  if (value.endsWith("/") || value.endsWith(".")) {
    throw new ConfigValidationError(
      `${prefix}: must not end with '/' or '.'`,
    );
  }
  if (value.includes("..")) {
    throw new ConfigValidationError(
      `${prefix}: must not contain '..'`,
    );
  }
  if (value.endsWith(".lock")) {
    throw new ConfigValidationError(
      `${prefix}: must not end with '.lock'`,
    );
  }
  const components = value.split("/");
  if (components.some((c) => c === "" || c.startsWith("."))) {
    throw new ConfigValidationError(
      `${prefix}: path components must not be empty or start with '.'`,
    );
  }
  return value;
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/");
}
