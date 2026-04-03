import { input, confirm } from "@inquirer/prompts";
import { stringify } from "yaml";
import fs from "fs";
import os from "os";
import path from "path";
import { CONFIG_PATH, LOGS_DIR } from "../utils/paths.js";
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
  getDefaultExecution,
} from "../utils/config-defaults.js";

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

interface RepositoryInput {
  owner: string;
  repo: string;
  local_path: string;
}

async function promptRepository(): Promise<RepositoryInput> {
  const owner = await input({
    message: "リポジトリの owner を入力してください:",
    validate: (v) =>
      /^[a-zA-Z0-9._-]+$/.test(v) || "英数字, '.', '_', '-' のみ使用できます",
  });
  const repo = await input({
    message: "リポジトリ名を入力してください:",
    validate: (v) =>
      /^[a-zA-Z0-9._-]+$/.test(v) || "英数字, '.', '_', '-' のみ使用できます",
  });
  const rawPath = await input({
    message: "ローカルクローンのパスを入力してください (~/ 可):",
    validate: (v) => {
      const expanded = expandTilde(v);
      return path.isAbsolute(expanded) || "絶対パスを入力してください (~/... も可)";
    },
  });
  const local_path = expandTilde(rawPath);
  return { owner, repo, local_path };
}

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
  if (fs.existsSync(CONFIG_PATH)) {
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
    default: LOGS_DIR,
    validate: (v) => {
      const expanded = expandTilde(v);
      return path.isAbsolute(expanded) || "絶対パスを入力してください (~/... も可)";
    },
  });
  const logDir = expandTilde(rawLogDir);

  // YAML 生成・書き込み
  const config = buildConfigData(repos, logDir);
  const yamlStr = stringify(config);
  fs.writeFileSync(CONFIG_PATH, yamlStr, "utf-8");

  console.log(`\nconfig.yml を作成しました: ${CONFIG_PATH}`);
  console.log(
    "次は `npx sabori-flow install` を実行してください。",
  );
}
