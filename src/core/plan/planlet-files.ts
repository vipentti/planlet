import { readFileSync } from "node:fs";

import { PlanletError } from "../../errors/planlet-error.js";
import { tryLstat } from "../paths.js";

export function assertActivePlanletDirectory(path: string, slug: string): void {
  const status = tryLstat(path);
  if (status?.isSymbolicLink()) {
    throw new PlanletError(
      "unsafe_path",
      `Planlet directory must not be a symbolic link: ${slug}`,
      { details: { slug, path } },
    );
  }
  if (!status?.isDirectory()) {
    throw new PlanletError("plan_not_found", `Planlet not found: ${slug}`, {
      details: { slug },
    });
  }
}

export function readMarkdown(path: string, filename: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new PlanletError("invalid_plan", `Cannot read ${filename}`, {
      details: { path },
      cause: error,
    });
  }
}
