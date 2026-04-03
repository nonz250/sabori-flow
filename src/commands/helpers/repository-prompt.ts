import { input } from "@inquirer/prompts";
import path from "node:path";
import { expandTilde } from "../../utils/paths.js";

export interface RepositoryInput {
  owner: string;
  repo: string;
  local_path: string;
}

export async function promptRepository(): Promise<RepositoryInput> {
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
