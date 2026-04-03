import { input, confirm } from "@inquirer/prompts";
import { stringify } from "yaml";
import fs from "fs";
import os from "os";
import path from "path";
import { CONFIG_PATH } from "../utils/paths";

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
  getDefaultExecution,
} from "../utils/config-defaults";

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

  // YAML 生成・書き込み
  const config = buildConfigData(repos);
  const yamlStr = stringify(config);
  fs.writeFileSync(CONFIG_PATH, yamlStr, "utf-8");

  console.log(`\nconfig.yml を作成しました: ${CONFIG_PATH}`);
  console.log(
    "次は `npx ts-node cli/src/index.ts install` を実行してください。",
  );
}
