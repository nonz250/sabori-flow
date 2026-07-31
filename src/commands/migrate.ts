import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { input, select, confirm } from "@inquirer/prompts";
import YAML, { type ParseOptions, type DocumentOptions, type SchemaOptions } from "yaml";
import { getConfigPath, getConfigBackupPath } from "../utils/paths.js";
import { YAML_PARSE_OPTIONS } from "../utils/yaml.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import {
  collectPendingSteps,
  readSchemaVersion,
  readIntervalMinutes,
  validateBranchNameInput,
  validateIntegerInput,
  CURRENT_SCHEMA_VERSION,
  type MigrationStep,
} from "./helpers/migration-steps.js";

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

export async function migrateCommand(): Promise<void> {
  try {
    setLanguage(loadLanguageFromConfig(getConfigPath()));

    if (!existsSync(getConfigPath())) {
      console.error(t("migrate.configNotFound"));
      console.error(t("migrate.runInitFirst"));
      return;
    }

    const raw = readFileSync(getConfigPath(), "utf-8");

    // parseDocument does not throw on invalid YAML; it collects errors
    // in doc.errors instead. An explicit length check is required.
    const doc = YAML.parseDocument(raw, YAML_PARSE_OPTIONS as ParseOptions & DocumentOptions & SchemaOptions);
    if (doc.errors.length > 0) {
      console.error(t("migrate.configParseFailed"));
      return;
    }

    const result = collectPendingSteps(doc);
    if (!result.ok) {
      switch (result.failure.kind) {
        case "not-a-mapping":
          console.error(t("migrate.configFormatInvalid"));
          return;
        case "repositories-invalid":
          console.error(t("migrate.repositoriesInvalid"));
          return;
        case "schema-version-newer":
          console.error(
            t("migrate.schemaVersionNewer", {
              recorded: String(result.failure.recorded),
              supported: String(result.failure.supported),
            }),
          );
          return;
      }
    }

    const { steps } = result;

    if (steps.length === 0 && readSchemaVersion(doc) === CURRENT_SCHEMA_VERSION) {
      console.log(t("migrate.alreadyUpToDate"));
      return;
    }

    const intervalBefore = readIntervalMinutes(doc);

    if (steps.length > 0) {
      console.log("");
      for (const step of steps) {
        console.log(t("migrate.keyAdded", { key: step.id }));
      }
      console.log("");
    }

    const answers = new Map<MigrationStep, unknown>();
    for (const step of steps) {
      if (step.prompt === null) {
        answers.set(step, step.defaultValue);
        continue;
      }

      const repoIndex = extractRepoIndex(step.path);

      switch (step.prompt.kind) {
        case "select": {
          const choices = step.prompt.choices.map((c) => ({ value: c, name: c }));
          const answer = await select({
            message: getPromptMessage(step, doc, repoIndex),
            choices,
            default: step.defaultValue as string,
          });
          answers.set(step, answer);
          break;
        }
        case "integer": {
          const spec = step.prompt;
          const answer = await input({
            message: getPromptMessage(step, doc, repoIndex),
            default: String(step.defaultValue),
            validate: (v) => validateIntegerInput(v, spec),
          });
          answers.set(step, Number(answer));
          break;
        }
        case "branch": {
          const answer = await input({
            message: getPromptMessage(step, doc, repoIndex),
            default: step.defaultValue as string,
            validate: validateBranchNameInput,
          });
          answers.set(step, answer);
          break;
        }
        case "confirm": {
          const answer = await confirm({
            message: getPromptMessage(step, doc, repoIndex),
            default: step.defaultValue as boolean,
          });
          answers.set(step, answer);
          break;
        }
      }
    }

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

    for (const step of steps) {
      const value = answers.get(step);
      doc.setIn([...step.path], doc.createNode(value));
    }
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

    console.log("");
    if (steps.length > 0) {
      for (const step of steps) {
        console.log(t("migrate.keyAdded", { key: step.id }));
      }
    }
    console.log(t("migrate.invalidValuesNotRepaired"));
    if (intervalBefore !== intervalAfter) {
      console.log(t("migrate.reinstallRequired"));
    } else {
      console.log(t("migrate.reinstallNotRequired"));
    }
    console.log(t("migrate.complete"));
  } catch {
    // Ctrl+C — exit silently
  }
}

function extractRepoIndex(path: readonly (string | number)[]): number | null {
  if (path[0] === "repositories" && typeof path[1] === "number") {
    return path[1];
  }
  return null;
}

function getPromptMessage(
  step: MigrationStep,
  doc: YAML.Document,
  repoIndex: number | null,
): string {
  if (step.id.endsWith(".default_branch") && repoIndex !== null) {
    return t("prompt.enterDefaultBranch", { repo: getRepoName(doc, repoIndex) });
  }
  if (step.id.endsWith(".auto_impl_after_plan") && repoIndex !== null) {
    return t("prompt.autoImplAfterPlan", { repo: getRepoName(doc, repoIndex) });
  }
  if (step.id === "execution.autonomy") {
    return t("prompt.autonomy");
  }
  if (step.id === "execution.interval_minutes") {
    return t("prompt.intervalMinutes");
  }
  if (step.id === "execution.timeout_minutes") {
    return t("prompt.timeoutMinutes");
  }
  if (step.id === "language") {
    return "Select language / 言語を選択してください:";
  }
  return step.id;
}
