import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

import { validatePlanletStructure } from "../../src/core/validation.js";

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

test("canonical skills expose valid metadata and resolvable local resources", () => {
  for (const name of SKILL_NAMES) {
    const skillPath = `skills/${name}/SKILL.md`;
    const markdown = read(skillPath);
    assert.match(markdown, new RegExp(`^---\\nname: ${name}\\n`));
    assert.match(markdown, /\ndescription: \S.+\n---\n/);

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

test("skills use supported rooted CLI forms and operation-specific fallback", () => {
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
    assert.match(markdown, /fallback for that operation only/);
    assert.match(
      markdown,
      /Continue using (?:the )?supported CLI operations|Continue using CLI for every supported operation/,
    );
    assert.doesNotMatch(markdown, /planlet (?:init|update|tools|archive)\b/);
  }
});

test("skills separate strategy, concise evidence, and lifecycle audit", () => {
  const planCorpus = filesUnder("skills/planlet-plan").map(read).join("\n");
  const implementCorpus = filesUnder("skills/planlet-implement")
    .map(read)
    .join("\n");
  const completeCorpus = filesUnder("skills/planlet-complete")
    .map(read)
    .join("\n");

  // plan.md owns static strategy only.
  assert.match(planCorpus, /`Verification` is strategy, not a run log/);
  assert.match(planCorpus, /never paste logs/);
  assert.match(
    planCorpus,
    /immutable commit SHAs and full stable URLs rather than moving branch, `latest`, or dashboard references/,
  );

  // implement maintains the optional concise note in tasks.md before completion.
  assert.match(
    implementCorpus,
    /## Verification Evidence` section in `tasks\.md`/,
  );
  assert.match(implementCorpus, /Before completion/);
  assert.match(implementCorpus, /Never paste logs or secrets/);
  assert.match(implementCorpus, /leave failed or unverified tasks unchecked/);

  // complete inspects without parsing, rerunning, or creating proof.
  assert.match(
    completeCorpus,
    /do not parse its semantics, rerun its checks, create missing proof/,
  );
  assert.match(completeCorpus, /lifecycle audit/);

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

interface DecisionRule {
  readonly skill: Scenario["skill"];
  readonly prompt: RegExp;
  readonly decision: string;
}

const DECISION_RULES: readonly DecisionRule[] = [
  {
    skill: "planlet-plan",
    prompt: /better search experience/i,
    decision: "clarify-material-unknowns",
  },
  {
    skill: "planlet-plan",
    prompt: /adding --csv.*unit and integration coverage/i,
    decision: "propose-without-extra-questions",
  },
  {
    skill: "planlet-plan",
    prompt: /do not save/i,
    decision: "leave-repository-unchanged",
  },
  {
    skill: "planlet-plan",
    prompt: /revise scope.*implementation tasks/i,
    decision: "reconcile-plan-and-tasks",
  },
  {
    skill: "planlet-implement",
    prompt: /underlying API changed/i,
    decision: "pause-on-material-drift",
  },
  {
    skill: "planlet-implement",
    prompt: /verification fails/i,
    decision: "leave-task-unchecked",
  },
  {
    skill: "planlet-implement",
    prompt: /without slug.*several active planlets/i,
    decision: "request-explicit-selection",
  },
  {
    skill: "planlet-complete",
    prompt: /unchecked tasks/i,
    decision: "request-confirmed-override",
  },
  {
    skill: "all",
    prompt: /generic Agent Skills, Claude Code, and Codex/i,
    decision: "use-canonical-resources",
  },
];

function evaluateDecision(scenario: Scenario, corpus: string): string {
  const matches = DECISION_RULES.filter(
    (rule) =>
      rule.skill === scenario.skill && rule.prompt.test(scenario.prompt),
  );
  assert.equal(matches.length, 1, `${scenario.id}: ambiguous scenario prompt`);
  for (const evidence of scenario.evidence) {
    assert.ok(corpus.includes(evidence), `${scenario.id}: missing ${evidence}`);
  }
  return matches[0]!.decision;
}

test("provider-neutral scenario suite evaluates required workflow decisions", () => {
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
    assert.equal(
      evaluateDecision(scenario, corpus),
      scenario.expectedDecision,
      `${scenario.id}: unexpected workflow decision`,
    );
  }

  const portable = scenarios.at(-1);
  assert.deepEqual(portable?.harnesses, ["agents", "claude", "codex"]);
});
