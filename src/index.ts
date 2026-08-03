import { runProductionEntry } from "./production-entry.js";

process.exitCode = await runProductionEntry();
