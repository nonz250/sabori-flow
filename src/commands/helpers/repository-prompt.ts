import { input, confirm } from "@inquirer/prompts";
import path from "node:path";
import { expandTilde } from "../../utils/paths.js";
import { t } from "../../i18n/index.js";

export interface RepositoryInput {
  owner: string;
  repo: string;
  local_path: string;
  auto_impl_after_plan: boolean;
  prompts_dir: string | null;
}

export async function promptRepository(): Promise<RepositoryInput> {
  const owner = await input({
    message: t("prompt.enterOwner"),
    validate: (v) =>
      /^[a-zA-Z0-9._-]+$/.test(v) || t("prompt.validationAlphanumeric"),
  });
  const repo = await input({
    message: t("prompt.enterRepo"),
    validate: (v) =>
      /^[a-zA-Z0-9._-]+$/.test(v) || t("prompt.validationAlphanumeric"),
  });
  const rawPath = await input({
    message: t("prompt.enterLocalPath"),
    validate: (v) => {
      const expanded = expandTilde(v);
      return path.isAbsolute(expanded) || t("prompt.validationAbsolutePath");
    },
  });
  const local_path = expandTilde(rawPath);
  const auto_impl_after_plan = await confirm({
    message: "Plan 完了後に自動で impl ラベルを付与しますか?",
    default: false,
  });
  const rawPromptsDir = await input({
    message:
      "カスタムプロンプトのディレクトリを指定しますか? (空欄でスキップ):",
    validate: (v) => {
      if (v === "") return true;
      const expanded = expandTilde(v);
      return (
        path.isAbsolute(expanded) || "絶対パスを入力してください (~/... も可)"
      );
    },
  });
  const prompts_dir =
    rawPromptsDir === "" ? null : expandTilde(rawPromptsDir);
  return { owner, repo, local_path, auto_impl_after_plan, prompts_dir };
}
