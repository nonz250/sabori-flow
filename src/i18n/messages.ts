import type { Language, MessageKeys } from "./types.js";

const jaMessages: MessageKeys = {
  // init command
  "init.configExistsOverwrite":
    "config.yml は既に存在します。上書きしますか?",
  "init.aborted": "中断しました。",
  "init.addAnotherRepo": "別のリポジトリを追加しますか?",
  "init.configCreated": "\nconfig.yml を作成しました: {path}",
  "init.runInstallNext":
    "次は `sabori-flow install` を実行してください。",
  "init.templateExists": "{file} は既に存在します。上書きしますか?",
  "init.templateSkipped": "スキップしました: {file}",
  "init.templatesCopied":
    "\nプロンプトテンプレートをコピーしました: {dir}",

  // add command
  "add.configNotFound": "Error: config.yml が見つかりません。",
  "add.runInitFirst":
    "先に `sabori-flow init` を実行してください。",
  "add.configReadFailed":
    "Error: config.yml の読み込みに失敗しました。内容を確認してください。",
  "add.configFormatInvalid": "Error: config.yml の形式が不正です。",
  "add.repositoriesInvalid":
    "Error: config.yml に repositories が定義されていないか、形式が不正です。",
  "add.duplicateOverwrite":
    "{owner}/{repo} は既に登録されています。上書きしますか?",
  "add.aborted": "中断しました。",
  "add.configWriteFailed":
    "Error: config.yml の書き込みに失敗しました。",
  "add.repoAdded": "\n{owner}/{repo} を追加しました。",

  // install command
  "install.configNotFound": "Error: config.yml が見つかりません。",
  "install.runInitFirst":
    "先に `sabori-flow init` を実行してください。",
  "install.npxNotFound":
    "Error: npx が見つかりません。Node.js をインストールしてください。",
  "install.nodeNotFound":
    "Error: node が見つかりません。Node.js をインストールしてください。",
  "install.pathResolveFailed":
    "Error: {label} のパスを正しく解決できませんでした。",
  "install.registeringScheduler": "スケジュールタスクを登録中...",
  "install.localComplete":
    "\nローカルビルドのワーカーを登録しました。{minutes}分ごとにワーカーが実行されます。",
  "install.complete":
    "\nインストールが完了しました。{minutes}分ごとにワーカーが実行されます。",
  "install.configValidationError": "Error: config.yml のバリデーションに失敗しました: {message}",
  "install.unsupportedPlatform": "Error: {message}",
  "install.unexpectedError": "予期しないエラーが発生しました:",

  // uninstall command
  "uninstall.removed": "スケジュールタスクを解除しました。",
  "uninstall.notRegistered": "スケジュールタスクは登録されていません。",
  "uninstall.complete": "\nアンインストールが完了しました。",
  "uninstall.confirmDeleteAll":
    "{dir} を完全に削除しますか? (config.yml, プロンプト, ログを含む)",
  "uninstall.deletedAll": "削除しました: {dir}",

  // repository-prompt (shared helper)
  "prompt.enterOwner": "リポジトリの owner を入力してください:",
  "prompt.enterRepo": "リポジトリ名を入力してください:",
  "prompt.enterLocalPath":
    "ローカルクローンのパスを入力してください (~/ 可):",
  "prompt.validationAlphanumeric":
    "英数字, '.', '_', '-' のみ使用できます",
  "prompt.validationAbsolutePath":
    "絶対パスを入力してください (~/... も可)",
  "prompt.autoImplConfirm":
    "Plan 完了後に自動で impl ラベルを付与しますか?",
  "prompt.intervalMinutes": "スケジュール実行間隔（分）を入力してください（10-1440）:",
  "prompt.intervalMinutesValidation": "10 以上 1440 以下の整数を入力してください",

  // cli descriptions
  "cli.descriptionAdd": "既存の config.yml にリポジトリを追加します",
  "cli.descriptionInit": "対話的に config.yml を作成します",
  "cli.descriptionInstall": "スケジュールタスクを登録します",
  "cli.optionLocal": "ローカルビルドのワーカーを登録します",
  "cli.descriptionUninstall": "スケジュールタスクを解除します",
  "cli.descriptionReinstall":
    "スケジュールタスクを再インストールします（解除 + 再登録）",
  "cli.optionReinstallLocal": "ローカルビルドのワーカーを登録します",
  "cli.descriptionWorker":
    "ワーカーを実行します（通常はスケジューラから自動的に呼び出されます）",
};

const enMessages: MessageKeys = {
  // init command
  "init.configExistsOverwrite": "config.yml already exists. Overwrite?",
  "init.aborted": "Aborted.",
  "init.addAnotherRepo": "Add another repository?",
  "init.configCreated": "\nconfig.yml created: {path}",
  "init.runInstallNext": "Next, run `sabori-flow install`.",
  "init.templateExists": "{file} already exists. Overwrite?",
  "init.templateSkipped": "Skipped: {file}",
  "init.templatesCopied": "\nPrompt templates copied to: {dir}",

  // add command
  "add.configNotFound": "Error: config.yml not found.",
  "add.runInitFirst": "Run `sabori-flow init` first.",
  "add.configReadFailed":
    "Error: Failed to read config.yml. Please check the file contents.",
  "add.configFormatInvalid": "Error: config.yml format is invalid.",
  "add.repositoriesInvalid":
    "Error: repositories is not defined or has an invalid format in config.yml.",
  "add.duplicateOverwrite": "{owner}/{repo} already exists. Overwrite?",
  "add.aborted": "Aborted.",
  "add.configWriteFailed": "Error: Failed to write config.yml.",
  "add.repoAdded": "\n{owner}/{repo} has been added.",

  // install command
  "install.configNotFound": "Error: config.yml not found.",
  "install.runInitFirst": "Run `sabori-flow init` first.",
  "install.npxNotFound":
    "Error: npx not found. Please install Node.js.",
  "install.nodeNotFound":
    "Error: node not found. Please install Node.js.",
  "install.pathResolveFailed":
    "Error: Failed to resolve path for {label}.",
  "install.registeringScheduler": "Registering scheduled task...",
  "install.localComplete":
    "\nLocal build worker registered. The worker will run every {minutes} minutes.",
  "install.complete":
    "\nInstallation complete. The worker will run every {minutes} minutes.",
  "install.configValidationError": "Error: config.yml validation failed: {message}",
  "install.unsupportedPlatform": "Error: {message}",
  "install.unexpectedError": "Unexpected error:",

  // uninstall command
  "uninstall.removed": "Scheduled task removed.",
  "uninstall.notRegistered": "No scheduled task is registered.",
  "uninstall.complete": "\nUninstall complete.",
  "uninstall.confirmDeleteAll":
    "Delete {dir} completely? (includes config.yml, prompts, and logs)",
  "uninstall.deletedAll": "Deleted: {dir}",

  // repository-prompt (shared helper)
  "prompt.enterOwner": "Enter repository owner:",
  "prompt.enterRepo": "Enter repository name:",
  "prompt.enterLocalPath": "Enter local clone path (~/... allowed):",
  "prompt.validationAlphanumeric":
    "Only alphanumeric characters, '.', '_', '-' are allowed",
  "prompt.validationAbsolutePath":
    "Enter an absolute path (~/... also accepted)",
  "prompt.autoImplConfirm":
    "Automatically add impl label after Plan completion?",
  "prompt.intervalMinutes": "Enter the scheduled execution interval in minutes (10-1440):",
  "prompt.intervalMinutesValidation": "Must be an integer between 10 and 1440",

  // cli descriptions
  "cli.descriptionAdd": "Add a repository to existing config.yml",
  "cli.descriptionInit": "Create config.yml interactively",
  "cli.descriptionInstall": "Register scheduled task",
  "cli.optionLocal": "Register local build worker",
  "cli.descriptionUninstall": "Remove scheduled task",
  "cli.descriptionReinstall":
    "Reinstall scheduled task (remove + re-register)",
  "cli.optionReinstallLocal": "Register local build worker",
  "cli.descriptionWorker":
    "Run the worker (normally called automatically by the scheduler)",
};

export const messages: Record<Language, MessageKeys> = {
  ja: jaMessages,
  en: enMessages,
};
