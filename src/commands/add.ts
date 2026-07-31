import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import YAML, { isMap, isSeq } from "yaml";
import type { ParseOptions, DocumentOptions, SchemaOptions, YAMLSeq } from "yaml";
import { getConfigPath } from "../utils/paths.js";
import { YAML_PARSE_OPTIONS } from "../utils/yaml.js";
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
} from "../utils/config-defaults.js";
import { promptRepository } from "./helpers/repository-prompt.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";

export async function addCommand(): Promise<void> {
  try {
    // Load language from config (falls back to default if config doesn't exist)
    setLanguage(loadLanguageFromConfig(getConfigPath()));

    // 1. config.yml existence check
    if (!existsSync(getConfigPath())) {
      console.error(t("add.configNotFound"));
      console.error(t("add.runInitFirst"));
      return;
    }

    // 2. Read + parse as Document (preserves comments)
    const raw = readFileSync(getConfigPath(), "utf-8");
    const doc = YAML.parseDocument(
      raw,
      YAML_PARSE_OPTIONS as ParseOptions & DocumentOptions & SchemaOptions,
    );
    if (doc.errors.length > 0) {
      console.error(t("add.configReadFailed"));
      return;
    }

    // 3. Structure validation
    if (!isMap(doc.contents)) {
      console.error(t("add.configFormatInvalid"));
      return;
    }
    const seq = doc.get("repositories");
    if (!isSeq(seq)) {
      console.error(t("add.repositoriesInvalid"));
      return;
    }

    // 4. 対話入力
    const repoInput = await promptRepository();

    // 5. 重複チェック
    const repoSeq = seq as YAMLSeq;
    let duplicateIndex = -1;
    for (let i = 0; i < repoSeq.items.length; i++) {
      const item = repoSeq.items[i];
      if (
        isMap(item) &&
        item.get("owner") === repoInput.owner &&
        item.get("repo") === repoInput.repo
      ) {
        duplicateIndex = i;
        break;
      }
    }
    if (duplicateIndex !== -1) {
      const overwrite = await confirm({
        message: t("add.duplicateOverwrite", { owner: repoInput.owner, repo: repoInput.repo }),
        default: false,
      });
      if (!overwrite) {
        console.log(t("add.aborted"));
        return;
      }
      repoSeq.delete(duplicateIndex);
    }

    // 6. 新エントリ構築 + 追加
    const newEntry = {
      owner: repoInput.owner,
      repo: repoInput.repo,
      local_path: repoInput.local_path,
      auto_impl_after_plan: repoInput.auto_impl_after_plan,
      labels: getDefaultLabels(),
      priority_labels: getDefaultPriorityLabels(),
    };
    repoSeq.add(doc.createNode(newEntry));

    // 7. 書き戻し
    try {
      writeFileSync(getConfigPath(), doc.toString(), { encoding: "utf-8", mode: 0o600 });
    } catch {
      console.error(t("add.configWriteFailed"));
      return;
    }

    // 8. 成功メッセージ
    console.log(t("add.repoAdded", { owner: repoInput.owner, repo: repoInput.repo }));
  } catch {
    // Ctrl+C — 静かに終了
  }
}
