#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("sabori-flow")
  .description("CLI for sabori-flow setup and management")
  .version(pkg.version);

program
  .command("add")
  .description("既存の config.yml にリポジトリを追加します")
  .action(addCommand);

program
  .command("init")
  .description("対話的に config.yml を作成します")
  .action(initCommand);

program
  .command("install")
  .description("plist 生成 + launchd 登録を行います")
  .action(installCommand);

program
  .command("uninstall")
  .description("launchd の登録を解除します")
  .action(uninstallCommand);

program.parse();
