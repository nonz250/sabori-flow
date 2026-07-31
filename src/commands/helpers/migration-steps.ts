import { Document, isMap, isSeq } from "yaml";
import {
  ConfigValidationError,
  validateBranchName,
  DEFAULT_BRANCH_DEFAULT,
  INTERVAL_MINUTES_MIN,
  INTERVAL_MINUTES_MAX,
  TIMEOUT_MINUTES_MIN,
  TIMEOUT_MINUTES_MAX,
} from "../../worker/config.js";
import {
  getDefaultExecution,
  getDefaultLabels,
  getDefaultPriorityLabels,
} from "../../utils/config-defaults.js";
import { Autonomy } from "../../worker/models.js";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../../i18n/types.js";

export const CURRENT_SCHEMA_VERSION = 1;

export type PromptSpec =
  | { readonly kind: "integer"; readonly min: number; readonly max: number }
  | { readonly kind: "select"; readonly choices: readonly string[] }
  | { readonly kind: "branch" }
  | { readonly kind: "confirm" };

export interface MigrationStep {
  readonly id: string;
  readonly path: readonly (string | number)[];
  readonly defaultValue: unknown;
  readonly prompt: PromptSpec | null;
}

export type CollectFailure =
  | { readonly kind: "not-a-mapping" }
  | { readonly kind: "repositories-invalid" }
  | { readonly kind: "schema-version-newer"; readonly recorded: number; readonly supported: number };

export type CollectResult =
  | { readonly ok: true; readonly steps: readonly MigrationStep[] }
  | { readonly ok: false; readonly failure: CollectFailure };

/**
 * Reads schema_version from the document.
 *
 * Returns 0 for any absent, non-integer, negative, or otherwise
 * anomalous value. Only values that are integers >= 0 are returned
 * as-is. The asymmetry is intentional: collectPendingSteps treats
 * only "strictly newer than CURRENT" as an abort condition, while
 * all other anomalies (missing, corrupt, negative) are normalized
 * to 0 so the document enters the normal migration flow.
 */
export function readSchemaVersion(doc: Document): number {
  const raw = doc.getIn(["schema_version"]);
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  return 0;
}

export function readIntervalMinutes(doc: Document): number {
  const raw = doc.getIn(["execution", "interval_minutes"]);
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw;
  }
  return getDefaultExecution().interval_minutes;
}

export function validateBranchNameInput(value: string): true | string {
  try {
    validateBranchName(value, "default_branch");
    return true;
  } catch (e: unknown) {
    if (e instanceof ConfigValidationError) {
      return e.message;
    }
    throw e;
  }
}

export function validateIntegerInput(
  value: string,
  spec: { min: number; max: number },
): true | string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
    return `Must be an integer between ${spec.min} and ${spec.max}`;
  }
  return true;
}

export function collectPendingSteps(doc: Document): CollectResult {
  // 1. Top-level must be a mapping
  if (!isMap(doc.contents)) {
    return { ok: false, failure: { kind: "not-a-mapping" } };
  }

  // 2. Schema version check
  const recorded = readSchemaVersion(doc);
  if (recorded > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      failure: { kind: "schema-version-newer", recorded, supported: CURRENT_SCHEMA_VERSION },
    };
  }

  // 3. Repositories validation
  const reposNode = doc.getIn(["repositories"]);
  if (!isSeq(reposNode)) {
    return { ok: false, failure: { kind: "repositories-invalid" } };
  }
  for (let i = 0; i < reposNode.items.length; i++) {
    if (!isMap(reposNode.items[i])) {
      return { ok: false, failure: { kind: "repositories-invalid" } };
    }
  }

  // 4. Collect missing keys as MigrationSteps.
  // Only keys absent from the document are flagged. Keys that exist but
  // hold invalid values (e.g. default_branch: "") are intentionally left
  // alone — loadConfig will detect and report those validation errors.
  const steps: MigrationStep[] = [];
  const defaults = getDefaultExecution();

  const rootKeys: {
    path: readonly string[];
    id: string;
    defaultValue: unknown;
    prompt: PromptSpec | null;
  }[] = [
    {
      path: ["language"],
      id: "language",
      defaultValue: DEFAULT_LANGUAGE,
      prompt: { kind: "select", choices: SUPPORTED_LANGUAGES },
    },
    {
      path: ["execution", "max_parallel"],
      id: "execution.max_parallel",
      defaultValue: defaults.max_parallel,
      prompt: null,
    },
    {
      path: ["execution", "max_issues_per_repo"],
      id: "execution.max_issues_per_repo",
      defaultValue: defaults.max_issues_per_repo,
      prompt: null,
    },
    {
      path: ["execution", "autonomy"],
      id: "execution.autonomy",
      defaultValue: defaults.autonomy,
      prompt: { kind: "select", choices: Object.values(Autonomy) },
    },
    {
      path: ["execution", "interval_minutes"],
      id: "execution.interval_minutes",
      defaultValue: defaults.interval_minutes,
      prompt: { kind: "integer", min: INTERVAL_MINUTES_MIN, max: INTERVAL_MINUTES_MAX },
    },
    {
      path: ["execution", "timeout_minutes"],
      id: "execution.timeout_minutes",
      defaultValue: defaults.timeout_minutes,
      prompt: { kind: "integer", min: TIMEOUT_MINUTES_MIN, max: TIMEOUT_MINUTES_MAX },
    },
  ];

  for (const key of rootKeys) {
    if (!doc.hasIn(key.path)) {
      steps.push({
        id: key.id,
        path: key.path,
        defaultValue: key.defaultValue,
        prompt: key.prompt,
      });
    }
  }

  const repoPerKeyDefs = [
    {
      key: "default_branch",
      defaultValue: DEFAULT_BRANCH_DEFAULT,
      prompt: { kind: "branch" } as PromptSpec,
    },
    {
      key: "auto_impl_after_plan",
      defaultValue: false,
      prompt: { kind: "confirm" } as PromptSpec,
    },
    {
      key: "labels",
      defaultValue: getDefaultLabels(),
      prompt: null,
    },
    {
      key: "priority_labels",
      defaultValue: getDefaultPriorityLabels(),
      prompt: null,
    },
  ];

  for (let i = 0; i < reposNode.items.length; i++) {
    for (const def of repoPerKeyDefs) {
      const path = ["repositories", i, def.key] as const;
      if (!doc.hasIn(path)) {
        steps.push({
          id: `repositories[${i}].${def.key}`,
          path,
          defaultValue: def.defaultValue,
          prompt: def.prompt,
        });
      }
    }
  }

  return { ok: true, steps };
}
