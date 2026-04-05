#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { setLanguage, loadLanguageFromConfig, t } from "./i18n/index.js";
import { getConfigPath } from "./utils/paths.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

setLanguage(loadLanguageFromConfig(getConfigPath()));

const program = new Command();

program
  .name("sabori-flow")
  .description("CLI for sabori-flow setup and management")
  .version(pkg.version);

program
  .command("add")
  .description(t("cli.descriptionAdd"))
  .action(addCommand);

program
  .command("init")
  .description(t("cli.descriptionInit"))
  .action(initCommand);

program
  .command("install")
  .description(t("cli.descriptionInstall"))
  .option("--local", t("cli.optionLocal"))
  .action((options) => installCommand(options));

program
  .command("uninstall")
  .description(t("cli.descriptionUninstall"))
  .action(uninstallCommand);

program
  .command("worker")
  .description(t("cli.descriptionWorker"))
  .action(async () => {
    const { workerMain } = await import("./worker/main.js");
    const exitCode = await workerMain();
    process.exit(exitCode);
  });

program.parse();
