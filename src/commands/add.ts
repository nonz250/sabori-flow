import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import YAML from "yaml";
import { CONFIG_PATH } from "../utils/paths.js";
import {
  getDefaultLabels,
  getDefaultPriorityLabels,
} from "../utils/config-defaults.js";
import { promptRepository } from "./helpers/repository-prompt.js";

export async function addCommand(): Promise<void> {
  // 1. config.yml 存在チェック
  if (!existsSync(CONFIG_PATH)) {
    console.error("Error: config.yml が見つかりません。");
    console.error("先に `npx sabori-flow init` を実行してください。");
    return;
  }

  // 2. 読み込み + パース
  let config: unknown;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    config = YAML.parse(raw);
  } catch {
    console.error(
      "Error: config.yml の読み込みに失敗しました。内容を確認してください。",
    );
    return;
  }

  // 3. 構造バリデーション
  if (typeof config !== "object" || config === null) {
    console.error("Error: config.yml の形式が不正です。");
    return;
  }
  const configObj = config as Record<string, unknown>;
  if (!Array.isArray(configObj.repositories)) {
    console.error(
      "Error: config.yml に repositories が定義されていないか、形式が不正です。",
    );
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
      message: `${repoInput.owner}/${repoInput.repo} は既に登録されています。上書きしますか?`,
      default: false,
    });
    if (!overwrite) {
      console.log("中断しました。");
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
  writeFileSync(CONFIG_PATH, YAML.stringify(configObj), "utf-8");

  // 8. 成功メッセージ
  console.log(`\n${repoInput.owner}/${repoInput.repo} を追加しました。`);
}
