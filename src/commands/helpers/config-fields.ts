import { isDeepStrictEqual } from "node:util";
import { Document, isMap, isNode, isSeq } from "yaml";
import {
  ConfigValidationError,
  DEFAULT_BRANCH_DEFAULT,
  DEFAULT_LABELS,
  INTERVAL_MINUTES_MAX,
  INTERVAL_MINUTES_MIN,
  MAX_ISSUES_PER_REPO_MAX,
  MAX_ISSUES_PER_REPO_MIN,
  MAX_PARALLEL_MAX,
  MAX_PARALLEL_MIN,
  PHASE_LABEL_KEYS,
  SPEC_LABEL_KEYS,
  TIMEOUT_MINUTES_MAX,
  TIMEOUT_MINUTES_MIN,
  parseAgents,
  parseDefaultBranch,
  parseLanguage,
  parsePriorityLabels,
  resolveLocalPath,
  validateAutoImplAfterPlan,
  validateAutonomy,
  validateIntegerInRange,
  validateLabelName,
  validateOwnerRepoValue,
} from "../../worker/config.js";
import {
  CONFIG_YAML_PARSE_OPTIONS,
  getDefaultExecution,
  getDefaultPriorityLabels,
} from "../../utils/config-defaults.js";
import { Autonomy, type SpecPhaseLabels } from "../../worker/models.js";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../../i18n/types.js";

export type FieldPath = readonly (string | number)[];

export type FieldInput =
  | { readonly kind: "integer"; readonly min: number; readonly max: number }
  | { readonly kind: "select"; readonly choices: readonly string[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "text" }
  | { readonly kind: "list" };

export interface ConfigField {
  readonly id: string;
  readonly path: FieldPath;
  readonly input: FieldInput;
  /** A missing required key is reported as invalid, not unset. */
  readonly required: boolean;
  /**
   * For an optional key, the value loadConfig applies when it is omitted.
   * For a required key, the value suggested when it is missing.
   */
  readonly defaultValue: unknown;
  /**
   * Fields sharing a group are written together: loadConfig requires every
   * key of a label phase once the phase exists, so setting one key of an
   * omitted phase fills the rest with their defaults.
   */
  readonly group: string | null;
  /** Validates a typed value with loadConfig's rules and returns the value to write. */
  readonly parse: (value: unknown) => unknown;
}

export type FieldState =
  | { readonly kind: "valid"; readonly value: unknown }
  | { readonly kind: "unset" }
  | { readonly kind: "invalid"; readonly value: unknown; readonly reason: string };

export interface EvaluatedField {
  readonly field: ConfigField;
  readonly state: FieldState;
}

export type CollectFailure =
  | { readonly kind: "not-a-mapping" }
  | { readonly kind: "repositories-invalid" }
  | { readonly kind: "section-invalid"; readonly path: string }
  | { readonly kind: "repo-not-found"; readonly repo: string };

export type CollectFieldsResult =
  | { readonly ok: true; readonly fields: readonly EvaluatedField[] }
  | { readonly ok: false; readonly failure: CollectFailure };

export interface CollectFieldsOptions {
  /** `owner/repo`. When set, only that repository's keys are collected. */
  readonly repo?: string;
}

export type FieldAnswer =
  | { readonly kind: "keep" }
  | { readonly kind: "set"; readonly value: unknown };

export interface PlannedChange {
  readonly id: string;
  readonly path: FieldPath;
  /** undefined when the key was absent */
  readonly before: unknown;
  readonly after: unknown;
}

const LIST_SEPARATOR = ",";
const INTEGER_TEXT_PATTERN = /^-?\d+$/;

const LABEL_PHASES = [
  { phase: "spec", keys: SPEC_LABEL_KEYS },
  { phase: "plan", keys: PHASE_LABEL_KEYS },
  { phase: "impl", keys: PHASE_LABEL_KEYS },
  { phase: "review", keys: PHASE_LABEL_KEYS },
] as const;

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Reads schema_version from the document.
 *
 * Returns 0 for any absent, non-integer, negative, or otherwise
 * anomalous value. Only values that are integers >= 0 are returned
 * as-is. The asymmetry is intentional: migrate treats only "strictly
 * newer than CURRENT" as an abort condition, while all other anomalies
 * (missing, corrupt, negative) are normalized to 0 so the document
 * enters the normal migration flow.
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

// ---------- Field catalog ----------

/** plan/impl phases lack the spec-only keys, which LABEL_PHASES never asks them for. */
type PhaseLabelsWithOptionalSpec = Partial<SpecPhaseLabels>;

function rootFields(): ConfigField[] {
  const defaults = getDefaultExecution();
  const integer = (
    key: string,
    defaultValue: number,
    min: number,
    max: number,
  ): ConfigField => ({
    id: `execution.${key}`,
    path: ["execution", key],
    input: { kind: "integer", min, max },
    required: false,
    defaultValue,
    group: null,
    parse: (v) => validateIntegerInRange(v, `execution.${key}`, min, max),
  });

  return [
    {
      id: "language",
      path: ["language"],
      input: { kind: "select", choices: SUPPORTED_LANGUAGES },
      required: false,
      defaultValue: DEFAULT_LANGUAGE,
      group: null,
      parse: (v) => parseLanguage(v),
    },
    integer("max_parallel", defaults.max_parallel, MAX_PARALLEL_MIN, MAX_PARALLEL_MAX),
    integer(
      "max_issues_per_repo",
      defaults.max_issues_per_repo,
      MAX_ISSUES_PER_REPO_MIN,
      MAX_ISSUES_PER_REPO_MAX,
    ),
    {
      id: "execution.agent",
      path: ["execution", "agent"],
      input: { kind: "list" },
      required: false,
      defaultValue: defaults.agent,
      group: null,
      // A single agent stays in its shorthand string form.
      parse: (v) => {
        const agents = parseAgents(v);
        return agents.length === 1 ? agents[0] : [...agents];
      },
    },
    {
      id: "execution.autonomy",
      path: ["execution", "autonomy"],
      input: {
        kind: "select",
        choices: [Autonomy.INTERACTIVE, Autonomy.AUTO, Autonomy.FULL],
      },
      required: false,
      defaultValue: defaults.autonomy,
      group: null,
      parse: (v) => validateAutonomy(v, "execution.autonomy"),
    },
    integer(
      "interval_minutes",
      defaults.interval_minutes,
      INTERVAL_MINUTES_MIN,
      INTERVAL_MINUTES_MAX,
    ),
    integer(
      "timeout_minutes",
      defaults.timeout_minutes,
      TIMEOUT_MINUTES_MIN,
      TIMEOUT_MINUTES_MAX,
    ),
  ];
}

/** config.yml label keys and the LabelsConfig properties holding their defaults. */
const LABEL_PROPERTIES: Record<(typeof SPEC_LABEL_KEYS)[number], keyof SpecPhaseLabels> = {
  trigger: "trigger",
  in_progress: "inProgress",
  done: "done",
  failed: "failed",
  review: "review",
  approved: "approved",
  needs_human: "needsHuman",
};

function repositoryFields(doc: Document, index: number): ConfigField[] {
  const base = `repositories[${index}]`;
  const path = (...rest: string[]): FieldPath => ["repositories", index, ...rest];

  const fields: ConfigField[] = [
    ...(["owner", "repo"] as const).map((key): ConfigField => ({
      id: `${base}.${key}`,
      path: path(key),
      input: { kind: "text" },
      required: true,
      defaultValue: undefined,
      group: null,
      parse: (v) => validateOwnerRepoValue(v, `${base}.${key}`),
    })),
    {
      id: `${base}.local_path`,
      path: path("local_path"),
      input: { kind: "text" },
      required: true,
      defaultValue: undefined,
      group: null,
      // Keep what the user wrote (e.g. a leading ~), not the resolved path.
      parse: (v) => {
        resolveLocalPath(v, `${base}.local_path`);
        return v;
      },
    },
    {
      id: `${base}.default_branch`,
      path: path("default_branch"),
      input: { kind: "text" },
      required: false,
      defaultValue: DEFAULT_BRANCH_DEFAULT,
      group: null,
      parse: (v) => parseDefaultBranch(v, `${base}.default_branch`),
    },
    {
      id: `${base}.auto_impl_after_plan`,
      path: path("auto_impl_after_plan"),
      input: { kind: "boolean" },
      required: false,
      defaultValue: false,
      group: null,
      parse: (v) => validateAutoImplAfterPlan(v, `${base}.auto_impl_after_plan`),
    },
    {
      id: `${base}.priority_labels`,
      path: path("priority_labels"),
      input: { kind: "list" },
      required: true,
      defaultValue: getDefaultPriorityLabels(),
      group: null,
      parse: (v) => parsePriorityLabels(v, `${base}.priority_labels`),
    },
  ];

  for (const { phase, keys } of LABEL_PHASES) {
    const group = `${base}.labels.${phase}`;
    const phaseExists = doc.hasIn(path("labels", phase));
    const defaults: PhaseLabelsWithOptionalSpec = DEFAULT_LABELS[phase];
    for (const key of keys) {
      fields.push({
        id: `${group}.${key}`,
        path: path("labels", phase, key),
        input: { kind: "text" },
        required: phaseExists,
        defaultValue: defaults[LABEL_PROPERTIES[key]],
        group,
        parse: (v) => validateLabelName(v, `${group}.${key}`),
      });
    }
  }

  return fields;
}

// ---------- Evaluation ----------

/** Reads a value as loadConfig sees it, with aliases resolved. */
function readValue(doc: Document, path: FieldPath): unknown {
  const node = doc.getIn(path, true);
  return isNode(node) ? node.toJS(doc, CONFIG_YAML_PARSE_OPTIONS) : node;
}

export function evaluateField(doc: Document, field: ConfigField): FieldState {
  if (!doc.hasIn(field.path)) {
    if (field.required) {
      return { kind: "invalid", value: undefined, reason: `${field.id}: required` };
    }
    return { kind: "unset" };
  }

  const raw = readValue(doc, field.path);
  try {
    return { kind: "valid", value: field.parse(raw) };
  } catch (e: unknown) {
    if (e instanceof ConfigValidationError) {
      return { kind: "invalid", value: raw, reason: e.message };
    }
    throw e;
  }
}

/** A section may be omitted or null, but anything else must be a mapping. */
function isInvalidSection(doc: Document, path: FieldPath, allowNull: boolean): boolean {
  if (!doc.hasIn(path)) {
    return false;
  }
  const node = doc.getIn(path, true);
  if (isMap(node)) {
    return false;
  }
  return !(allowNull && doc.getIn(path) === null);
}

export function collectFields(
  doc: Document,
  options: CollectFieldsOptions = {},
): CollectFieldsResult {
  if (!isMap(doc.contents)) {
    return { ok: false, failure: { kind: "not-a-mapping" } };
  }

  const reposNode = doc.getIn(["repositories"]);
  if (!isSeq(reposNode) || reposNode.items.some((item) => !isMap(item))) {
    return { ok: false, failure: { kind: "repositories-invalid" } };
  }

  let indexes = reposNode.items.map((_, i) => i);
  if (options.repo !== undefined) {
    // GitHub owner and repository names are case-insensitive.
    const wanted = options.repo.toLowerCase();
    indexes = indexes.filter(
      (i) =>
        `${String(doc.getIn(["repositories", i, "owner"]))}/${String(doc.getIn(["repositories", i, "repo"]))}`.toLowerCase() ===
        wanted,
    );
    if (indexes.length === 0) {
      return { ok: false, failure: { kind: "repo-not-found", repo: options.repo } };
    }
  }

  const sections: { path: FieldPath; allowNull: boolean }[] = [];
  if (options.repo === undefined) {
    // loadConfig treats `execution: null` the same as an omitted section.
    sections.push({ path: ["execution"], allowNull: true });
  }
  for (const i of indexes) {
    sections.push({ path: ["repositories", i, "labels"], allowNull: false });
    for (const { phase } of LABEL_PHASES) {
      sections.push({ path: ["repositories", i, "labels", phase], allowNull: false });
    }
  }
  for (const section of sections) {
    if (isInvalidSection(doc, section.path, section.allowNull)) {
      return {
        ok: false,
        failure: { kind: "section-invalid", path: formatPath(section.path) },
      };
    }
  }

  const fields = [
    ...(options.repo === undefined ? rootFields() : []),
    ...indexes.flatMap((i) => repositoryFields(doc, i)),
  ];

  return {
    ok: true,
    fields: fields.map((field) => ({ field, state: evaluateField(doc, field) })),
  };
}

function formatPath(path: FieldPath): string {
  return path
    .map((part, i) => (typeof part === "number" ? `[${part}]` : i === 0 ? part : `.${part}`))
    .join("");
}

// ---------- Text conversion ----------

/** Renders a typed value as the text a prompt shows and accepts back. */
export function toText(field: ConfigField, value: unknown): string {
  if (field.input.kind === "list" && Array.isArray(value)) {
    return value.map(String).join(`${LIST_SEPARATOR} `);
  }
  return String(value);
}

/**
 * Converts prompt text into a typed value and validates it.
 *
 * @throws {ConfigValidationError} when the text is not a valid value
 */
export function fromText(field: ConfigField, text: string): unknown {
  const trimmed = text.trim();
  switch (field.input.kind) {
    case "integer":
      if (!INTEGER_TEXT_PATTERN.test(trimmed)) {
        throw new ConfigValidationError(`${field.id}: must be an integer, got '${trimmed}'`);
      }
      return field.parse(Number(trimmed));
    case "list":
      return field.parse(
        trimmed
          .split(LIST_SEPARATOR)
          .map((item) => item.trim())
          .filter((item) => item !== ""),
      );
    case "boolean":
      return field.parse(trimmed === "true" ? true : trimmed === "false" ? false : trimmed);
    case "select":
    case "text":
      return field.parse(trimmed);
  }
}

/** Returns true when the text is valid, otherwise loadConfig's error message. */
export function validateFieldText(field: ConfigField, text: string): true | string {
  try {
    fromText(field, text);
    return true;
  } catch (e: unknown) {
    if (e instanceof ConfigValidationError) {
      return e.message;
    }
    throw e;
  }
}

// ---------- Planning ----------

/**
 * Turns prompt answers into the writes to perform. Re-entering the current
 * value is not a change, and setting one key of an omitted label phase
 * also writes the phase's other keys with their defaults.
 */
export function planChanges(
  evaluated: readonly EvaluatedField[],
  answers: ReadonlyMap<ConfigField, FieldAnswer>,
): PlannedChange[] {
  const changes: PlannedChange[] = [];
  const touchedGroups = new Set<string>();

  for (const { field, state } of evaluated) {
    const answer = answers.get(field);
    if (answer === undefined || answer.kind === "keep") {
      continue;
    }
    if (state.kind === "valid" && isDeepStrictEqual(state.value, answer.value)) {
      continue;
    }
    changes.push({
      id: field.id,
      path: field.path,
      before: state.kind === "unset" ? undefined : state.value,
      after: answer.value,
    });
    if (field.group !== null && state.kind === "unset") {
      touchedGroups.add(field.group);
    }
  }

  const changedIds = new Set(changes.map((c) => c.id));
  for (const { field, state } of evaluated) {
    if (
      field.group !== null &&
      touchedGroups.has(field.group) &&
      state.kind === "unset" &&
      !changedIds.has(field.id)
    ) {
      changes.push({
        id: field.id,
        path: field.path,
        before: undefined,
        after: field.defaultValue,
      });
    }
  }

  return changes;
}

/** Writes the planned values in place, keeping comments and unknown keys. */
export function applyChanges(doc: Document, changes: readonly PlannedChange[]): void {
  for (const change of changes) {
    replaceNullParents(doc, change.path);
    doc.setIn([...change.path], doc.createNode(change.after));
  }
}

/** setIn cannot descend into a null scalar such as `execution:` with no value. */
function replaceNullParents(doc: Document, path: FieldPath): void {
  for (let depth = 1; depth < path.length; depth++) {
    const parent = path.slice(0, depth);
    if (doc.hasIn(parent) && doc.getIn(parent) === null) {
      doc.setIn([...parent], doc.createNode({}));
    }
  }
}
