import fs from "fs";
import { getConfigPath } from "../utils/paths.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { loadConfig, ConfigValidationError } from "../worker/config.js";
import {
  readRawConfigDocument,
  inspectConfig,
} from "../worker/config-inspect.js";
import { renderConfigInspection } from "./helpers/config-render.js";

export function showCommand(
  options: { verbose?: boolean } = {},
): void {
  const configPath = getConfigPath();

  setLanguage(loadLanguageFromConfig(configPath));

  if (!fs.existsSync(configPath)) {
    console.error(t("show.configNotFound"));
    console.error(t("show.runInitFirst"));
    process.exitCode = 1;
    return;
  }

  try {
    const config = loadConfig(configPath);
    const raw = readRawConfigDocument(configPath);
    const inspection = inspectConfig(config, raw);
    const { lines, hasDefaultValues } = renderConfigInspection(inspection, {
      verbose: options.verbose === true,
    });

    console.log(t("show.header", { path: configPath }));
    console.log("");
    console.log(lines.join("\n"));

    if (hasDefaultValues) {
      console.log("");
      console.log(t("show.defaultLegend"));
    }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(
        t("show.configValidationError", { message: error.message }),
      );
    } else {
      console.error(t("show.unexpectedError"), error);
    }
    process.exitCode = 1;
  }
}
