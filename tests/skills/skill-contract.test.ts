import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

import { AGENT_SNIPPET } from "../../src/core/harness/agent-snippet.js";
import { validatePlanletStructure } from "../../src/core/plan/validation.js";

const ROOT = resolve(import.meta.dirname, "../..");
const SKILL_NAMES = [
  "planlet-plan",
  "planlet-implement",
  "planlet-complete",
] as const;

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

function normalizedWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Canonical CLI availability policy: the generated agent-onboarding snippet
 * and every bundled skill must carry this exact wording, whitespace aside.
 * Keep in sync with `AGENT_SNIPPET` and the three canonical `SKILL.md` files.
 */
const CLI_POLICY =
  "The `planlet` CLI is required. If no executable is available, install it (`npm install -g @vipentti/planlet`) or invoke it through `npx @vipentti/planlet`. If it still cannot run, stop and report that, naming the missing executable. Do not reimplement CLI operations by editing planlet files.";

test("canonical skills expose valid metadata and resolvable local resources", () => {
  for (const name of SKILL_NAMES) {
    const skillPath = `skills/${name}/SKILL.md`;
    const markdown = read(skillPath);
    assert.match(
      markdown,
      new RegExp(
        `^---\\nname: ${name}\\ndescription: \\S.+\\n` +
          `allowed-tools: Bash\\(planlet:\\*\\)\\n` +
          `compatibility: Requires planlet CLI\\.\\n` +
          `license: MIT\\n---\\n`,
      ),
    );

    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      assert.ok(target);
      assert.equal(
        existsSync(resolve(dirname(join(ROOT, skillPath)), target)),
        true,
        `${skillPath} references missing ${target}`,
      );
    }
  }
});

test("skills use supported rooted CLI forms and require the planlet CLI", () => {
  const plan = read("skills/planlet-plan/SKILL.md");
  const implement = read("skills/planlet-implement/SKILL.md");
  const complete = read("skills/planlet-complete/SKILL.md");

  for (const command of [
    'planlet --root "<repository-root>" create <slug> --title "<title>"',
    'planlet --root "<repository-root>" validate <slug>',
    'planlet --root "<repository-root>" --full show <slug> --part plan',
  ]) {
    assert.ok(plan.includes(command), `plan skill missing ${command}`);
  }
  for (const command of [
    'planlet --root "<repository-root>" validate <slug>',
    'planlet --root "<repository-root>" task check <slug> <task-id>',
    'planlet --root "<repository-root>" tasks <slug> --remaining',
    'planlet --root "<repository-root>" status <slug>',
  ]) {
    assert.ok(
      implement.includes(command),
      `implement skill missing ${command}`,
    );
  }
  for (const command of [
    'planlet --root "<repository-root>" tasks <slug> --remaining',
    'planlet --root "<repository-root>" complete <slug>',
    'planlet --root "<repository-root>" complete <slug> --allow-incomplete --reason "<reason>"',
  ]) {
    assert.ok(complete.includes(command), `complete skill missing ${command}`);
  }

  for (const markdown of [plan, implement, complete]) {
    assert.match(markdown, /shell-specific escaping/);
    assert.doesNotMatch(markdown, /--root <repository-root>/);
    assert.ok(
      normalizedWhitespace(markdown).includes(CLI_POLICY),
      "skill must carry the canonical CLI policy verbatim",
    );
    assert.doesNotMatch(markdown, /fallback/i);
    assert.doesNotMatch(markdown, /planlet (?:init|update|tools|archive)\b/);
    assert.doesNotMatch(markdown, /stop and say so/);
  }

  // The generated onboarding snippet expresses the same policy as the skills.
  assert.ok(
    normalizedWhitespace(AGENT_SNIPPET).includes(CLI_POLICY),
    "agent snippet must carry the canonical CLI policy verbatim",
  );
  // The retired immediate-stop wording must not return in either surface.
  assert.doesNotMatch(normalizedWhitespace(AGENT_SNIPPET), /stop and say so/);
});

test("skills keep evidence exceptional, write-once, and separate from the audit", () => {
  const planCorpus = filesUnder("skills/planlet-plan").map(read).join("\n");
  const implementCorpus = filesUnder("skills/planlet-implement")
    .map(read)
    .join("\n");
  const completeCorpus = filesUnder("skills/planlet-complete")
    .map(read)
    .join("\n");

  // plan.md owns static strategy only, and expects no routine results anywhere.
  assert.match(planCorpus, /`Verification` is strategy, not a run log/);
  assert.match(planCorpus, /never paste logs/);
  assert.match(
    planCorpus,
    /Committed verification evidence is exceptional and absent by default/,
  );

  // implement writes a note only for facts ordinary history cannot reconstruct.
  assert.match(implementCorpus, /`## Verification Evidence` section/);
  assert.match(implementCorpus, /absent by default|absence is the normal/);
  assert.match(implementCorpus, /write-once/);
  assert.match(
    implementCorpus,
    /Never write a current-head or otherwise self-referential commit SHA/,
  );
  assert.match(implementCorpus, /leave failed or unverified tasks unchecked/);

  // complete inspects without parsing, rerunning, or creating proof, and never gates on evidence.
  assert.match(
    completeCorpus,
    /do not parse its semantics, rerun its checks, create missing proof/,
  );
  assert.match(completeCorpus, /absence is normal and never blocks completion/);
  assert.match(completeCorpus, /lifecycle audit/);
  assert.match(completeCorpus, /never uncheck an already-checked task/);

  // the superseded universal-anchor expectation must not return, in any wording.
  for (const corpus of [planCorpus, implementCorpus, completeCorpus]) {
    assert.doesNotMatch(corpus, /immutable commit SHA/i);
    assert.doesNotMatch(corpus, /full stable URLs?/i);
  }

  // no skill invents an evidence command or schema.
  for (const corpus of [planCorpus, implementCorpus, completeCorpus]) {
    assert.doesNotMatch(corpus, /planlet (?:evidence|verify)\b/);
  }
});

test("plan and task templates satisfy Phase 2 file contract", () => {
  const plan = read("skills/planlet-plan/assets/plan-template.md");
  const tasks = read("skills/planlet-plan/assets/tasks-template.md");
  const result = validatePlanletStructure({
    directoryName: "plan-title",
    location: "active",
    planMarkdown: plan,
    tasksMarkdown: tasks,
  });

  assert.equal(result.state, "planned");
  assert.deepEqual(
    result.tasks.map((task) => task.id),
    ["T1", "T2", "T3"],
  );
  for (const heading of [
    "## Summary",
    "## Scope",
    "## Approach",
    "## Acceptance Criteria",
    "## Verification",
  ]) {
    assert.match(plan, new RegExp(`^${heading}$`, "m"));
  }
});

test("generic and Claude bootstrap copies are byte-identical to canonical skills", () => {
  for (const name of SKILL_NAMES) {
    const canonicalRoot = `skills/${name}`;
    const canonicalFiles = filesUnder(canonicalRoot).map((path) =>
      relative(canonicalRoot, path),
    );

    for (const destination of [".agents/skills", ".claude/skills"]) {
      const copyRoot = `${destination}/${name}`;
      const copyFiles = filesUnder(copyRoot).map((path) =>
        relative(copyRoot, path),
      );
      assert.deepEqual(copyFiles.sort(), canonicalFiles.sort());
      for (const file of canonicalFiles) {
        assert.equal(
          read(`${copyRoot}/${file}`),
          read(`${canonicalRoot}/${file}`),
          `${copyRoot}/${file} differs`,
        );
      }
    }
  }
});

interface Scenario {
  readonly id: string;
  readonly skill: (typeof SKILL_NAMES)[number] | "all";
  readonly prompt: string;
  readonly expectedDecision: string;
  readonly evidence: readonly string[];
  readonly harnesses?: readonly string[];
}

test("provider-neutral scenario suite checks required evidence", () => {
  const scenarios = JSON.parse(
    read("tests/fixtures/skills/scenarios.json"),
  ) as Scenario[];
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    [
      "vague-planning",
      "precise-planning",
      "declined-persistence",
      "consistent-revision",
      "implementation-drift",
      "failed-verification",
      "multiple-targets",
      "incomplete-completion",
      "ready-handoff",
      "portable-canonical-workflow",
    ],
  );

  for (const scenario of scenarios) {
    assert.ok(scenario.prompt.length > 0);
    assert.ok(scenario.expectedDecision.length > 0);
    assert.ok(scenario.evidence.length > 0);
    const names = scenario.skill === "all" ? SKILL_NAMES : [scenario.skill];
    const corpus = names
      .flatMap((name) =>
        filesUnder(`skills/${name}`)
          .filter((path) => statSync(join(ROOT, path)).isFile())
          .map((path) => read(path)),
      )
      .join("\n");
    for (const evidence of scenario.evidence) {
      assert.ok(
        corpus.includes(evidence),
        `${scenario.id}: missing ${evidence}`,
      );
    }
  }

  const portable = scenarios.at(-1);
  assert.deepEqual(portable?.harnesses, [
    "agents",
    "claude",
    "codex",
    "github-copilot",
  ]);
});
