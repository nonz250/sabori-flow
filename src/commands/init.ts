import { input, confirm } from "@inquirer/prompts";
import { stringify } from "yaml";
import fs from "fs";
import path from "path";
import { getConfigDir, getConfigPath, getLogsDir, expandTilde } from "../utils/paths.js";
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
  getDefaultExecution,
} from "../utils/config-defaults.js";
import {
  type RepositoryInput,
  promptRepository,
} from "./helpers/repository-prompt.js";

function buildConfigData(repos: RepositoryInput[], logDir: string) {
  return {
    repositories: repos.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      local_path: r.local_path,
      labels: getDefaultLabels(),
      priority_labels: getDefaultPriorityLabels(),
    })),
    execution: { ...getDefaultExecution(), log_dir: logDir },
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

  // ログ出力先
  const rawLogDir = await input({
    message: `ログ出力先のパスを入力してください (~/ 可):`,
    default: getLogsDir(),
    validate: (v) => {
      const expanded = expandTilde(v);
      return path.isAbsolute(expanded) || "絶対パスを入力してください (~/... も可)";
    },
  });
  const logDir = expandTilde(rawLogDir);

  // YAML 生成・書き込み
  const config = buildConfigData(repos, logDir);
  const yamlStr = stringify(config);
  fs.writeFileSync(getConfigPath(), yamlStr, { encoding: "utf-8", mode: 0o600 });

  console.log(`\nconfig.yml を作成しました: ${getConfigPath()}`);
  console.log(
    "次は `sabori-flow install` を実行してください。",
  );
}
