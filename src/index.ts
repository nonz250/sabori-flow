#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";

const program = new Command();

program
  .name("claude-issue-worker")
  .description("CLI for claude-issue-worker setup and management")
  .version("0.1.0");

program
  .command("init")
  .description("対話的に config.yml を作成します")
  .action(initCommand);

program
  .command("install")
  .description("npm install + ビルド + launchd 登録を行います")
  .action(installCommand);

program
  .command("uninstall")
  .description("launchd の登録を解除します")
  .action(uninstallCommand);

program.parse();
