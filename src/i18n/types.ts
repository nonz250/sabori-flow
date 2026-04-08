export type Language = "ja" | "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["ja", "en"] as const;

export const DEFAULT_LANGUAGE: Language = "ja";

export interface MessageKeys {
  // init command
  "init.configExistsOverwrite": string;
  "init.aborted": string;
  "init.addAnotherRepo": string;
  "init.configCreated": string;
  "init.runInstallNext": string;
  "init.templateExists": string;
  "init.templateSkipped": string;
  "init.templatesCopied": string;

  // add command
  "add.configNotFound": string;
  "add.runInitFirst": string;
  "add.configReadFailed": string;
  "add.configFormatInvalid": string;
  "add.repositoriesInvalid": string;
  "add.duplicateOverwrite": string;
  "add.aborted": string;
  "add.configWriteFailed": string;
  "add.repoAdded": string;

  // install command
  "install.configNotFound": string;
  "install.runInitFirst": string;
  "install.npxNotFound": string;
  "install.nodeNotFound": string;
  "install.pathResolveFailed": string;
  "install.generatingPlist": string;
  "install.registeringLaunchd": string;
  "install.localComplete": string;
  "install.complete": string;
  "install.configValidationError": string;
  "install.unexpectedError": string;

  // uninstall command
  "uninstall.deleted": string;
  "uninstall.notRegistered": string;
  "uninstall.complete": string;
  "uninstall.confirmDeleteAll": string;
  "uninstall.deletedAll": string;

  // repository-prompt (shared helper)
  "prompt.enterOwner": string;
  "prompt.enterRepo": string;
  "prompt.enterLocalPath": string;
  "prompt.validationAlphanumeric": string;
  "prompt.validationAbsolutePath": string;
  "prompt.autoImplConfirm": string;
  "prompt.selectAgent": string;
  "prompt.intervalMinutes": string;
  "prompt.intervalMinutesValidation": string;

  // cli descriptions
  "cli.descriptionAdd": string;
  "cli.descriptionInit": string;
  "cli.descriptionInstall": string;
  "cli.optionLocal": string;
  "cli.descriptionUninstall": string;
  "cli.descriptionReinstall": string;
  "cli.optionReinstallLocal": string;
  "cli.descriptionWorker": string;
}
