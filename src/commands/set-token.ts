import { password } from "@inquirer/prompts";
import { getConfigPath } from "../utils/paths.js";
import { writeAuthToken } from "../utils/auth-token.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";

export async function setTokenCommand(): Promise<void> {
  setLanguage(loadLanguageFromConfig(getConfigPath()));

  console.log(t("setToken.instructions"));

  let token: string;
  try {
    token = await password({
      message: t("setToken.prompt"),
      mask: true,
      validate: (input: string) =>
        input.trim() !== "" || t("setToken.emptyError"),
    });
  } catch {
    // Ctrl+C — 静かに終了
    return;
  }

  try {
    writeAuthToken(token);
  } catch {
    console.error(t("setToken.writeFailed"));
    return;
  }

  console.log(t("setToken.saved"));
}
