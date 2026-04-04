import { uninstallCommand } from "./uninstall.js";
import { installCommand } from "./install.js";

export async function reinstallCommand(
  options: { local?: boolean } = {},
): Promise<void> {
  await uninstallCommand();
  await installCommand(options);
}
