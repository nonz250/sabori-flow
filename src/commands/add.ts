import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import YAML from "yaml";
import { getConfigPath } from "../utils/paths.js";
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
} from "../utils/config-defaults.js";
import { promptRepository } from "./helpers/repository-prompt.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";

export async function addCommand(): Promise<void> {
  // Load language from config (falls back to default if config doesn't exist)
  setLanguage(loadLanguageFromConfig(getConfigPath()));

  // 1. config.yml existence check
  if (!existsSync(getConfigPath())) {
    console.error(t("add.configNotFound"));
    console.error(t("add.runInitFirst"));
    return;
  }

  // 2. Read + parse
  let config: unknown;
  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    config = YAML.parse(raw, { maxAliasCount: 100 });
  } catch {
    console.error(t("add.configReadFailed"));
    return;
  }

  // 3. Structure validation
  if (typeof config !== "object" || config === null) {
    console.error(t("add.configFormatInvalid"));
    return;
  }
  const configObj = config as Record<string, unknown>;
  if (!Array.isArray(configObj.repositories)) {
    console.error(t("add.repositoriesInvalid"));
    return;
  }
  const repositories = configObj.repositories as Array<
    Record<string, unknown>
  >;

  // 4. 対話入力
  const repoInput = await promptRepository();

  // 5. 重複チェック
  const duplicateIndex = repositories.findIndex(
    (r) => r.owner === repoInput.owner && r.repo === repoInput.repo,
  );
  if (duplicateIndex !== -1) {
    const overwrite = await confirm({
      message: t("add.duplicateOverwrite", { owner: repoInput.owner, repo: repoInput.repo }),
      default: false,
    });
    if (!overwrite) {
      console.log(t("add.aborted"));
      return;
    }
    repositories.splice(duplicateIndex, 1);
  }

  // 6. 新エントリ構築 + 追加
  repositories.push({
    owner: repoInput.owner,
    repo: repoInput.repo,
    local_path: repoInput.local_path,
    labels: getDefaultLabels(),
    priority_labels: getDefaultPriorityLabels(),
  });

  // 7. 書き戻し
  try {
    writeFileSync(getConfigPath(), YAML.stringify(configObj), { encoding: "utf-8", mode: 0o600 });
  } catch {
    console.error(t("add.configWriteFailed"));
    return;
  }

  // 8. 成功メッセージ
  console.log(t("add.repoAdded", { owner: repoInput.owner, repo: repoInput.repo }));
}
