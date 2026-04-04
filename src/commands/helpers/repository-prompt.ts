import { input } from "@inquirer/prompts";
import path from "node:path";
import { expandTilde } from "../../utils/paths.js";
import { t } from "../../i18n/index.js";

export interface RepositoryInput {
  owner: string;
  repo: string;
  local_path: string;
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
  return { owner, repo, local_path };
}
