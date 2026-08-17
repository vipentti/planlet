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

test("compact task index keeps template tasks single-line and guidance controls present", () => {
  const guidance = read("skills/planlet-plan/references/planning-guidance.md");
  const template = read("skills/planlet-plan/assets/tasks-template.md");
  const planSkill = read("skills/planlet-plan/SKILL.md");

  // helper: paragraphs are blank-line separated blocks; steps are numbered workflow items in SKILL.md
  function paragraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  function skillSteps(text: string): string[] {
    // numbered steps in Develop the proposal section (e.g. "5. Turn...", "6. Before presenting...")
    return text
      .split(/(?=^\d+\.\s)/m)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // template tasks are single-line and short, with no nested content outside the HTML comment
  const taskLines = template
    .split("\n")
    .filter((line) => /^\s*- \[[ x]\] T\d+\b/.test(line));
  assert.equal(taskLines.length, 3);
  for (const line of taskLines) {
    const description = line.replace(/^\s*- \[[ x]\] T\d+\s+/, "").trim();
    assert.equal(description.includes("\n"), false);
    const words = description.split(/\s+/).filter(Boolean);
    assert.ok(
      words.length <= 25,
      `template task too long (${words.length} words): ${description}`,
    );
  }
  const templateWithoutComment = template.replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(templateWithoutComment, /\n {2,}[-*+]\s/);
  assert.doesNotMatch(templateWithoutComment, /\n {2,}\S/);

  // retired permissive wording is absent everywhere, without exact-prose matching
  assert.doesNotMatch(guidance, /about 60/i);
  assert.doesNotMatch(guidance, /approaching 100/i);

  // word targets and enforcement disclaimer occupy the same paragraph, proving the relationship
  const guidanceParagraphs = paragraphs(guidance);
  const targetParagraph = guidanceParagraphs.find(
    (p) => /25/i.test(p) && /50/i.test(p) && /words/i.test(p),
  );
  assert.ok(
    targetParagraph,
    "guidance must have a 25/50-word target paragraph",
  );
  assert.match(targetParagraph, /no tool enforces/i);
  assert.match(targetParagraph, /not parser/i);

  // compression pass paragraph couples the step timing, the reread operation, and the relocation invariant
  const compressionParagraph = guidanceParagraphs.find((p) =>
    /compression pass/i.test(p),
  );
  assert.ok(
    compressionParagraph,
    "guidance must have a compression pass paragraph",
  );
  assert.match(compressionParagraph, /Before presenting/i);
  assert.match(compressionParagraph, /reread/i);
  assert.match(compressionParagraph, /tasks\.md/i);
  assert.match(compressionParagraph, /plan\.md/i);
  assert.match(compressionParagraph, /relocates detail/i);

  // task-local metadata exceptional scope: one paragraph defines exceptional, bare outcome, Verify, and the when-useful guard together
  const metadataParagraph = guidanceParagraphs.find((p) =>
    /Task-local metadata is exceptional/i.test(p),
  );
  assert.ok(
    metadataParagraph,
    "guidance must have a task-local metadata paragraph",
  );
  assert.match(metadataParagraph, /bare outcome/i);
  assert.match(metadataParagraph, /Verify:/);
  assert.match(metadataParagraph, /only when useful/i);
  assert.match(metadataParagraph, /never to a task-local clause/i);

  // sparing nested lists and substantial-explanation exception share one paragraph
  const nestingParagraph = guidanceParagraphs.find(
    (p) => /sparingly/i.test(p) && /must not become/i.test(p),
  );
  assert.ok(
    nestingParagraph,
    "guidance must have a sparing-nested-list paragraph",
  );
  assert.match(nestingParagraph, /nested/i);
  assert.match(nestingParagraph, /another specification surface/i);
  assert.match(nestingParagraph, /substantial explanation/i);
  assert.match(nestingParagraph, /move/i);
  assert.match(nestingParagraph, /plan\.md/i);

  // Task-boundary rule: independently meaningful delivered outcomes as sole criterion, folded with split-rather-than-compress, every checkbox as coherent outcome
  const boundaryParagraph = guidanceParagraphs.find((p) =>
    /Task boundaries follow/i.test(p),
  );
  assert.ok(boundaryParagraph, "guidance must have a task-boundary paragraph");
  assert.match(
    boundaryParagraph,
    /independently meaningful delivered outcomes/i,
  );
  assert.match(boundaryParagraph, /sole\s+split criterion/i);
  // proves one checkbox == one coherent outcome relationship in a single paragraph
  assert.match(boundaryParagraph, /every resulting checkbox/i);
  assert.match(boundaryParagraph, /coherent delivered outcome/i);
  assert.match(boundaryParagraph, /splitting rather than compressing/i);
  // tolerates several requirements when they serve one outcome, requirements stay in plan.md
  assert.match(boundaryParagraph, /several.*requirements/i);
  assert.match(boundaryParagraph, /keep those requirements in/i);
  assert.match(boundaryParagraph, /plan\.md/i);
  // implementability/verifiability only evidence, never sufficient
  assert.match(boundaryParagraph, /only evidence/i);
  assert.match(boundaryParagraph, /never sufficient/i);
  // word-count pressure must not change semantic boundaries
  assert.match(boundaryParagraph, /word-count pressure/i);
  assert.match(boundaryParagraph, /semantic task boundaries/i);
  // anti-mechanical guard preserved in same paragraph
  assert.match(boundaryParagraph, /Do not\s+split\s+mechanically/i);

  // SKILL.md compression step delegates operational detail to planning guidance in one workflow step
  const steps = skillSteps(planSkill);
  const compressionStep = steps.find((s) => /compression pass/i.test(s));
  assert.ok(compressionStep, "SKILL.md must have a compression pass step");
  assert.match(compressionStep, /Before presenting/i);
  assert.match(compressionStep, /tasks\.md/i);
  assert.match(compressionStep, /plan\.md/i);
  // relationship: the delegation appears in the same step, not via the generic earlier planning-guidance link
  assert.match(compressionStep, /planning-guidance\.md/i);
  assert.match(compressionStep, /for the full[\s\S]*procedure/i);
  assert.ok(
    planSkill.indexOf("compression pass") <
      planSkill.indexOf("Present the proposed plan"),
    "compression pass must appear before presentation step",
  );
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
