import { select, confirm } from "@inquirer/prompts";
import { stringify } from "yaml";
import fs from "fs";
import { getConfigDir, getConfigPath } from "../utils/paths.js";
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
  getDefaultExecution,
} from "../utils/config-defaults.js";
import {
  type RepositoryInput,
  promptRepository,
} from "./helpers/repository-prompt.js";
import { setLanguage, t } from "../i18n/index.js";
import type { Language } from "../i18n/types.js";

function buildConfigData(repos: RepositoryInput[], language: string) {
  return {
    language,
    repositories: repos.map((r) => {
      const entry: Record<string, unknown> = {
        owner: r.owner,
        repo: r.repo,
        local_path: r.local_path,
        auto_impl_after_plan: r.auto_impl_after_plan,
      };
      if (r.prompts_dir !== null) {
        entry.prompts_dir = r.prompts_dir;
      }
      entry.labels = getDefaultLabels();
      entry.priority_labels = getDefaultPriorityLabels();
      return entry;
    }),
    execution: getDefaultExecution(),
  };
}

export async function initCommand(): Promise<void> {
  // config.yml 存在チェック
  // XDG 準拠: config ディレクトリを事前作成
  fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });

  const language = await select<Language>({
    message: "Select language / 言語を選択してください:",
    choices: [
      { value: "ja", name: "日本語" },
      { value: "en", name: "English" },
    ],
  });
  setLanguage(language);

  if (fs.existsSync(getConfigPath())) {
    const overwrite = await confirm({
      message: t("init.configExistsOverwrite"),
      default: false,
    });
    if (!overwrite) {
      console.log(t("init.aborted"));
      return;
    }
  }

  // リポジトリ入力ループ
  const repos: RepositoryInput[] = [];
  do {
    repos.push(await promptRepository());
  } while (
    await confirm({
      message: t("init.addAnotherRepo"),
      default: false,
    })
  );

  // YAML 生成・書き込み
  const config = buildConfigData(repos, language);
  const yamlStr = stringify(config);
  fs.writeFileSync(getConfigPath(), yamlStr, { encoding: "utf-8", mode: 0o600 });

  console.log(t("init.configCreated", { path: getConfigPath() }));
  console.log(t("init.runInstallNext"));
}
