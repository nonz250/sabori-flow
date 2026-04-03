import { workerMain } from "./worker/main.js";

const exitCode = await workerMain();
process.exit(exitCode);
