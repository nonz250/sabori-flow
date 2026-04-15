import { uninstallCommand } from "./uninstall.js";
import { installCommand } from "./install.js";
import type { SchedulerType } from "./install.js";

export async function reinstallCommand(
  options: { local?: boolean; scheduler?: SchedulerType } = {},
): Promise<void> {
  await uninstallCommand({ interactive: false });
  await installCommand(options);
}
