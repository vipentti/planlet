import { PlanletError } from "../errors/planlet-error.js";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

export interface ParsedArchiveName {
  readonly archiveName: string;
  readonly archiveDate: string;
  readonly slug: string;
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && !/^\d+$/.test(value);
}

export function assertValidSlug(value: string): string {
  if (!isValidSlug(value)) {
    throw new PlanletError("invalid_slug", `Invalid planlet slug: ${value}`, {
      details: { slug: value },
      next: "Use lowercase ASCII letters, digits, and single hyphens; include at least one letter.",
    });
  }

  return value;
}

export function isRealArchiveDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function parseArchiveName(value: string): ParsedArchiveName | null {
  const match = ARCHIVE_NAME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const archiveDate = match[1];
  const slug = match[2];
  if (
    archiveDate === undefined ||
    slug === undefined ||
    !isRealArchiveDate(archiveDate) ||
    !isValidSlug(slug)
  ) {
    return null;
  }

  return Object.freeze({ archiveName: value, archiveDate, slug });
}

export function assertValidArchiveName(value: string): ParsedArchiveName {
  const parsed = parseArchiveName(value);
  if (parsed === null) {
    throw new PlanletError(
      "invalid_plan",
      `Invalid completed planlet archive name: ${value}`,
      { details: { archiveName: value } },
    );
  }

  return parsed;
}

export function archiveDateFromInstant(completedAt: Date): string {
  if (Number.isNaN(completedAt.valueOf())) {
    throw new PlanletError("invalid_plan", "Invalid completion timestamp");
  }

  return completedAt.toISOString().slice(0, 10);
}

export function createArchiveName(slug: string, completedAt: Date): string {
  return `${archiveDateFromInstant(completedAt)}-${assertValidSlug(slug)}`;
}
