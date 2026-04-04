import { confirm } from "@inquirer/prompts";
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

function buildConfigData(repos: RepositoryInput[]) {
  return {
    repositories: repos.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      local_path: r.local_path,
      labels: getDefaultLabels(),
      priority_labels: getDefaultPriorityLabels(),
    })),
    execution: getDefaultExecution(),
  };
}

export async function initCommand(): Promise<void> {
  // config.yml 存在チェック
  // XDG 準拠: config ディレクトリを事前作成
  fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });

  if (fs.existsSync(getConfigPath())) {
    const overwrite = await confirm({
      message: "config.yml は既に存在します。上書きしますか?",
      default: false,
    });
    if (!overwrite) {
      console.log("中断しました。");
      return;
    }
  }

  // リポジトリ入力ループ
  const repos: RepositoryInput[] = [];
  do {
    repos.push(await promptRepository());
  } while (
    await confirm({
      message: "別のリポジトリを追加しますか?",
      default: false,
    })
  );

  // YAML 生成・書き込み
  const config = buildConfigData(repos);
  const yamlStr = stringify(config);
  fs.writeFileSync(getConfigPath(), yamlStr, { encoding: "utf-8", mode: 0o600 });

  console.log(`\nconfig.yml を作成しました: ${getConfigPath()}`);
  console.log(
    "次は `sabori-flow install` を実行してください。",
  );
}
