import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { input, select, confirm } from "@inquirer/prompts";
import YAML from "yaml";
import { getConfigPath, getConfigBackupPath } from "../utils/paths.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import {
  applyChanges,
  collectFields,
  fromText,
  planChanges,
  readIntervalMinutes,
  readSchemaVersion,
  toText,
  validateFieldText,
  CURRENT_SCHEMA_VERSION,
  type ConfigField,
  type EvaluatedField,
  type FieldAnswer,
  type PlannedChange,
} from "./helpers/config-fields.js";

export interface MigrateOptions {
  /** `owner/repo`. Limits the review to that repository's keys. */
  readonly repo?: string;
}

const KEEP_UNSET = Symbol("keep-unset");

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function getRepoName(doc: YAML.Document, index: number): string {
  const owner = doc.getIn(["repositories", index, "owner"]);
  const repo = doc.getIn(["repositories", index, "repo"]);
  if (typeof owner === "string" && typeof repo === "string") {
    return `${owner}/${repo}`;
  }
  return `repositories[${index}]`;
}

/** Shows repository keys under the repository's name instead of its index. */
function displayName(doc: YAML.Document, id: string, path: ConfigField["path"]): string {
  if (path[0] === "repositories" && typeof path[1] === "number") {
    const prefix = `repositories[${path[1]}].`;
    return `[${getRepoName(doc, path[1])}] ${id.slice(prefix.length)}`;
  }
  return id;
}

function formatValue(field: ConfigField, value: unknown): string {
  return value === undefined ? t("migrate.unsetValue") : toText(field, value);
}

/**
 * The text a prompt starts with: the current value when valid, the value to
 * fix when invalid, or the suggested default for a missing required key.
 * An omitted optional key starts empty so that Enter leaves it omitted.
 */
function initialText({ field, state }: EvaluatedField): string | undefined {
  switch (state.kind) {
    case "valid":
      return toText(field, state.value);
    case "unset":
      return undefined;
    case "invalid":
      if (state.value === undefined) {
        return field.defaultValue === undefined ? undefined : toText(field, field.defaultValue);
      }
      return typeof state.value === "string" || typeof state.value === "number"
        ? String(state.value)
        : undefined;
  }
}

function buildMessage(doc: YAML.Document, evaluated: EvaluatedField): string {
  const { field, state } = evaluated;
  const hints: string[] = [];
  if (field.input.kind === "integer") {
    hints.push(t("migrate.hintRange", { min: String(field.input.min), max: String(field.input.max) }));
  }
  if (field.input.kind === "list") {
    hints.push(t("migrate.hintList"));
  }
  // Choice prompts carry the default in their "leave unset" choice instead.
  const isChoice = field.input.kind === "select" || field.input.kind === "boolean";
  if (state.kind === "unset" && !isChoice) {
    hints.push(t("migrate.hintUnset", { default: formatValue(field, field.defaultValue) }));
  }
  if (state.kind === "invalid") {
    hints.push(t("migrate.hintInvalid", { reason: state.reason }));
  }
  const name = displayName(doc, field.id, field.path);
  return hints.length === 0 ? `${name}:` : `${name} (${hints.join(" / ")}):`;
}

async function askChoice(
  message: string,
  evaluated: EvaluatedField,
  choices: { value: unknown; name: string }[],
): Promise<FieldAnswer> {
  const { field, state } = evaluated;
  const allChoices =
    state.kind === "unset"
      ? [
          {
            value: KEEP_UNSET as unknown,
            name: t("migrate.choiceKeepUnset", { default: formatValue(field, field.defaultValue) }),
          },
          ...choices,
        ]
      : choices;
  const answer = await select<unknown>({
    message,
    choices: allChoices,
    default: state.kind === "valid" ? state.value : allChoices[0].value,
  });
  return answer === KEEP_UNSET ? { kind: "keep" } : { kind: "set", value: field.parse(answer) };
}

async function askText(message: string, evaluated: EvaluatedField): Promise<FieldAnswer> {
  const { field, state } = evaluated;
  const answer = await input({
    message,
    default: initialText(evaluated),
    validate: (text) => {
      if (text.trim() === "") {
        if (state.kind === "unset") {
          return true;
        }
        if (state.kind === "invalid") {
          return t("migrate.valueRequired");
        }
      }
      return validateFieldText(field, text);
    },
  });
  if (answer.trim() === "" && state.kind === "unset") {
    return { kind: "keep" };
  }
  return { kind: "set", value: fromText(field, answer) };
}

async function ask(doc: YAML.Document, evaluated: EvaluatedField): Promise<FieldAnswer> {
  const message = buildMessage(doc, evaluated);
  const { input: spec } = evaluated.field;
  switch (spec.kind) {
    case "select":
      return askChoice(
        message,
        evaluated,
        spec.choices.map((c) => ({ value: c, name: c })),
      );
    case "boolean":
      return askChoice(message, evaluated, [
        { value: true, name: "true" },
        { value: false, name: "false" },
      ]);
    case "integer":
    case "text":
    case "list":
      return askText(message, evaluated);
  }
}

function printChanges(
  doc: YAML.Document,
  changes: readonly PlannedChange[],
  fieldsById: ReadonlyMap<string, ConfigField>,
): void {
  for (const change of changes) {
    const field = fieldsById.get(change.id)!;
    console.log(
      t("migrate.changeLine", {
        key: displayName(doc, change.id, change.path),
        before: formatValue(field, change.before),
        after: formatValue(field, change.after),
      }),
    );
  }
}

export async function migrateCommand(options: MigrateOptions = {}): Promise<void> {
  try {
    setLanguage(loadLanguageFromConfig(getConfigPath()));

    if (!existsSync(getConfigPath())) {
      console.error(t("migrate.configNotFound"));
      console.error(t("migrate.runInitFirst"));
      return;
    }

    const raw = readFileSync(getConfigPath(), "utf-8");

    // parseDocument itself does not resolve aliases. config-fields resolves
    // each value with CONFIG_YAML_PARSE_OPTIONS, which applies the alias limit.
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      console.error(t("migrate.configParseFailed"));
      return;
    }

    const recorded = readSchemaVersion(doc);
    if (recorded > CURRENT_SCHEMA_VERSION) {
      console.error(
        t("migrate.schemaVersionNewer", {
          recorded: String(recorded),
          supported: String(CURRENT_SCHEMA_VERSION),
        }),
      );
      return;
    }

    const result = collectFields(doc, { repo: options.repo });
    if (!result.ok) {
      switch (result.failure.kind) {
        case "not-a-mapping":
          console.error(t("migrate.configFormatInvalid"));
          return;
        case "repositories-invalid":
          console.error(t("migrate.repositoriesInvalid"));
          return;
        case "section-invalid":
          console.error(t("migrate.sectionInvalid", { path: result.failure.path }));
          return;
        case "repo-not-found":
          console.error(t("migrate.repoNotFound", { repo: result.failure.repo }));
          return;
      }
    }

    const intervalBefore = readIntervalMinutes(doc);

    const answers = new Map<ConfigField, FieldAnswer>();
    for (const evaluated of result.fields) {
      answers.set(evaluated.field, await ask(doc, evaluated));
    }

    const changes = planChanges(result.fields, answers);
    const versionOutdated = recorded !== CURRENT_SCHEMA_VERSION;
    if (changes.length === 0 && !versionOutdated) {
      console.log(t("migrate.noChanges"));
      return;
    }

    const fieldsById = new Map(result.fields.map(({ field }) => [field.id, field]));
    console.log("");
    console.log(t("migrate.changesHeader"));
    printChanges(doc, changes, fieldsById);
    if (versionOutdated) {
      console.log(
        t("migrate.changeLine", {
          key: "schema_version",
          before: recorded === 0 ? t("migrate.unsetValue") : String(recorded),
          after: String(CURRENT_SCHEMA_VERSION),
        }),
      );
    }
    console.log("");

    const shouldApply = await confirm({
      message: t("migrate.confirmApply"),
      default: true,
    });
    if (!shouldApply) {
      console.log(t("migrate.aborted"));
      return;
    }

    const timestamp = formatTimestamp(new Date());
    const backupPath = getConfigBackupPath(timestamp);
    try {
      writeFileSync(backupPath, raw, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    } catch {
      console.error(t("migrate.backupFailed"));
      return;
    }

    applyChanges(doc, changes);
    doc.setIn(["schema_version"], doc.createNode(CURRENT_SCHEMA_VERSION));

    const intervalAfter = readIntervalMinutes(doc);

    // ~/.sabori-flow is created with 0700 by init. The backup written
    // above with the wx flag provides a recovery path if this write is
    // interrupted, so a temp-file-plus-rename pattern is not necessary.
    try {
      writeFileSync(getConfigPath(), doc.toString(), { encoding: "utf-8", mode: 0o600 });
    } catch {
      console.error(t("migrate.configWriteFailed", { backupPath }));
      return;
    }

    if (intervalBefore !== intervalAfter) {
      console.log(t("migrate.reinstallRequired"));
    } else {
      console.log(t("migrate.reinstallNotRequired"));
    }
    console.log(t("migrate.complete"));
  } catch (error: unknown) {
    // Ctrl+C at a prompt: nothing has been written, so exit quietly.
    if (error instanceof Error && error.name === "ExitPromptError") {
      return;
    }
    console.error(t("migrate.unexpectedError"), error);
    process.exitCode = 1;
  }
}
