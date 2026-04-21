import { input, select, confirm } from "@inquirer/prompts";
import { stringify } from "yaml";
import fs from "fs";
import { join, resolve } from "node:path";
import { getBaseDir, getConfigPath, getUserPromptsDir, getDefaultPromptsDir } from "../utils/paths.js";
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
import { Autonomy } from "../worker/models.js";
import { TEMPLATE_FILES } from "../worker/prompt.js";

function buildConfigData(
  repos: RepositoryInput[],
  language: string,
  intervalMinutes: number,
  timeoutMinutes: number,
  autonomy: Autonomy,
) {
  return {
    language,
    repositories: repos.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      local_path: r.local_path,
      auto_impl_after_plan: r.auto_impl_after_plan,
      labels: getDefaultLabels(),
      priority_labels: getDefaultPriorityLabels(),
    })),
    execution: {
      ...getDefaultExecution(),
      autonomy,
      interval_minutes: intervalMinutes,
      timeout_minutes: timeoutMinutes,
    },
  };
}

async function copyPromptTemplates(language: Language): Promise<void> {
  const srcDir = join(getDefaultPromptsDir(), language);
  const destDir = getUserPromptsDir();
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

  for (const filename of Object.values(TEMPLATE_FILES)) {
    const src = resolve(srcDir, filename);
    const dest = resolve(destDir, filename);

    if (fs.existsSync(dest)) {
      const overwrite = await confirm({
        message: t("init.templateExists", { file: filename }),
        default: false,
      });
      if (!overwrite) {
        console.log(t("init.templateSkipped", { file: filename }));
        continue;
      }
    }

    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o600);
  }

  console.log(t("init.templatesCopied", { dir: destDir }));
}

export async function initCommand(): Promise<void> {
  try {
    // ベースディレクトリを事前作成
    fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });

    const language = await select<Language>({
      message: "Select language / 言語を選択してください:",
      choices: [
        { value: "ja", name: "日本語" },
        { value: "en", name: "English" },
      ],
    });
    setLanguage(language);

    await copyPromptTemplates(language);

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

    // autonomy 選択 (sandboxed は手動編集専用のため UI には載せない)
    const autonomy = await select<Autonomy>({
      message: t("prompt.autonomy"),
      choices: [
        {
          value: Autonomy.INTERACTIVE,
          name: t("prompt.autonomyChoiceInteractive"),
          description: t("prompt.autonomyDescInteractive"),
        },
        {
          value: Autonomy.AUTO,
          name: t("prompt.autonomyChoiceAuto"),
          description: t("prompt.autonomyDescAuto"),
        },
        {
          value: Autonomy.FULL,
          name: t("prompt.autonomyChoiceFull"),
          description: t("prompt.autonomyDescFull"),
        },
      ],
      default: Autonomy.INTERACTIVE,
    });

    // interval_minutes 入力
    const intervalMinutesStr = await input({
      message: t("prompt.intervalMinutes"),
      default: "60",
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 10 || n > 1440) {
          return t("prompt.intervalMinutesValidation");
        }
        return true;
      },
    });
    const intervalMinutes = Number(intervalMinutesStr);

    // timeout_minutes 入力
    const timeoutMinutesStr = await input({
      message: t("prompt.timeoutMinutes"),
      default: "60",
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 240) {
          return t("prompt.timeoutMinutesValidation");
        }
        return true;
      },
    });
    const timeoutMinutes = Number(timeoutMinutesStr);

    // YAML 生成・書き込み
    const config = buildConfigData(repos, language, intervalMinutes, timeoutMinutes, autonomy);
    const yamlStr = stringify(config);
    fs.writeFileSync(getConfigPath(), yamlStr, { encoding: "utf-8", mode: 0o600 });

    console.log(t("init.configCreated", { path: getConfigPath() }));
    console.log(t("init.runInstallNext"));
  } catch {
    // Ctrl+C — 静かに終了
  }
}
