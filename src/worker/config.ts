import { readFileSync, realpathSync } from "node:fs";
import YAML from "yaml";

import type {
  AppConfig,
  ExecutionConfig,
  RepositoryConfig,
  LabelsConfig,
  PhaseLabels,
} from "./models.js";
import { expandTilde } from "../utils/paths.js";
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
const LABEL_PATTERN = /^[a-zA-Z0-9./:_ -]+$/;
const PHASE_LABEL_KEYS = ["trigger", "in_progress", "done", "failed"] as const;

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
    data = YAML.parse(rawText, { maxAliasCount: 100 });
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
  const execution = parseExecution(
    "execution" in record ? record["execution"] : undefined,
  );

  const language = parseLanguage(
    "language" in record ? record["language"] : undefined,
  );

  return { language, repositories, execution };
}

// ---------- Internal parsers ----------

function parseLanguage(raw: unknown): Language {
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

    const rawLocalPath = record["local_path"];
    if (typeof rawLocalPath !== "string" || rawLocalPath === "") {
      throw new ConfigValidationError(
        `${prefix}.local_path: must be a non-empty string`,
      );
    }

    const localPath = expandTilde(rawLocalPath);

    if (!isAbsolutePath(localPath)) {
      throw new ConfigValidationError(
        `${prefix}.local_path: must be an absolute path, got '${localPath}'`,
      );
    }

    let resolvedLocalPath: string;
    try {
      resolvedLocalPath = realpathSync(localPath);
    } catch {
      throw new ConfigValidationError(
        `${prefix}.local_path: path does not exist: '${localPath}'`,
      );
    }

    // labels
    if (!("labels" in record)) {
      throw new ConfigValidationError(`${prefix}: 'labels' is required`);
    }

    const labelsRaw = record["labels"];
    if (
      labelsRaw === null ||
      typeof labelsRaw !== "object" ||
      Array.isArray(labelsRaw)
    ) {
      throw new ConfigValidationError(`${prefix}.labels: must be a mapping`);
    }

    const labelsRecord = labelsRaw as Record<string, unknown>;

    if (!("plan" in labelsRecord)) {
      throw new ConfigValidationError(
        `${prefix}.labels: 'plan' key is required`,
      );
    }
    if (!("impl" in labelsRecord)) {
      throw new ConfigValidationError(
        `${prefix}.labels: 'impl' key is required`,
      );
    }

    const plan = parsePhaseLabels(
      labelsRecord["plan"],
      `${prefix}.labels.plan`,
    );
    const impl = parsePhaseLabels(
      labelsRecord["impl"],
      `${prefix}.labels.impl`,
    );

    const labels: LabelsConfig = { plan, impl };

    // priority_labels
    if (!("priority_labels" in record)) {
      throw new ConfigValidationError(
        `${prefix}: 'priority_labels' is required`,
      );
    }

    const priorityRaw = record["priority_labels"];
    if (!Array.isArray(priorityRaw)) {
      throw new ConfigValidationError(
        `${prefix}.priority_labels: must be a list`,
      );
    }

    for (let j = 0; j < priorityRaw.length; j++) {
      const item = priorityRaw[j] as unknown;
      if (typeof item !== "string") {
        throw new ConfigValidationError(
          `${prefix}.priority_labels[${j}]: must be a string`,
        );
      }
      if (!LABEL_PATTERN.test(item)) {
        throw new ConfigValidationError(
          `${prefix}.priority_labels[${j}]: invalid characters in '${item}' ` +
            `(must match ${LABEL_PATTERN.source})`,
        );
      }
    }

    // auto_impl_after_plan (optional, default: false)
    let autoImplAfterPlan = false;
    if ("auto_impl_after_plan" in record) {
      const rawAutoImpl = record["auto_impl_after_plan"];
      if (typeof rawAutoImpl !== "boolean") {
        throw new ConfigValidationError(
          `${prefix}.auto_impl_after_plan: must be a boolean, got ${typeof rawAutoImpl}`,
        );
      }
      autoImplAfterPlan = rawAutoImpl;
    }

    configs.push({
      owner,
      repo,
      localPath: resolvedLocalPath,
      labels,
      priorityLabels: priorityRaw as string[],
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

  const value = entry[key];
  if (typeof value !== "string" || value === "") {
    throw new ConfigValidationError(
      `${prefix}.${key}: must be a non-empty string`,
    );
  }

  if (!OWNER_REPO_PATTERN.test(value)) {
    throw new ConfigValidationError(
      `${prefix}.${key}: invalid characters in '${value}' ` +
        `(must match ${OWNER_REPO_PATTERN.source})`,
    );
  }

  return value;
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

    const value = record[key];
    if (typeof value !== "string") {
      throw new ConfigValidationError(`${phaseName}.${key}: must be a string`);
    }

    if (!LABEL_PATTERN.test(value)) {
      throw new ConfigValidationError(
        `${phaseName}.${key}: invalid characters in '${value}' ` +
          `(must match ${LABEL_PATTERN.source})`,
      );
    }

    values[key] = value;
  }

  return {
    trigger: values["trigger"],
    inProgress: values["in_progress"],
    done: values["done"],
    failed: values["failed"],
  };
}

function parseExecution(raw: unknown): ExecutionConfig {
  if (raw === undefined || raw === null) {
    return { maxParallel: 1, maxIssuesPerRepo: 1, skipPermissions: true };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError("'execution' must be a mapping");
  }

  const record = raw as Record<string, unknown>;

  // max_parallel
  const rawMaxParallel =
    "max_parallel" in record ? record["max_parallel"] : 1;

  if (typeof rawMaxParallel !== "number" || !Number.isInteger(rawMaxParallel)) {
    throw new ConfigValidationError(
      `execution.max_parallel: must be an integer, got ${typeof rawMaxParallel}`,
    );
  }

  if (rawMaxParallel < 1) {
    throw new ConfigValidationError(
      `execution.max_parallel: must be >= 1, got ${rawMaxParallel}`,
    );
  }

  if (rawMaxParallel > 10) {
    throw new ConfigValidationError(
      `execution.max_parallel: must be <= 10, got ${rawMaxParallel}`,
    );
  }

  // max_issues_per_repo
  const rawMaxIssuesPerRepo =
    "max_issues_per_repo" in record ? record["max_issues_per_repo"] : 1;

  if (typeof rawMaxIssuesPerRepo !== "number" || !Number.isInteger(rawMaxIssuesPerRepo)) {
    throw new ConfigValidationError(
      `execution.max_issues_per_repo: must be an integer, got ${typeof rawMaxIssuesPerRepo}`,
    );
  }

  if (rawMaxIssuesPerRepo < 1) {
    throw new ConfigValidationError(
      `execution.max_issues_per_repo: must be >= 1, got ${rawMaxIssuesPerRepo}`,
    );
  }

  if (rawMaxIssuesPerRepo > 20) {
    throw new ConfigValidationError(
      `execution.max_issues_per_repo: must be <= 20, got ${rawMaxIssuesPerRepo}`,
    );
  }

  // skip_permissions
  const rawSkipPermissions =
    "skip_permissions" in record ? record["skip_permissions"] : true;

  if (typeof rawSkipPermissions !== "boolean") {
    throw new ConfigValidationError(
      `execution.skip_permissions: must be a boolean, got ${typeof rawSkipPermissions}`,
    );
  }

  return { maxParallel: rawMaxParallel, maxIssuesPerRepo: rawMaxIssuesPerRepo, skipPermissions: rawSkipPermissions };
}

// ---------- Helpers ----------

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/");
}
