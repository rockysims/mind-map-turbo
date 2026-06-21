---
name: mm-plan
description: Write, revise, or prepare execution of roadmap milestone plans for the mind-map Turborepo. Use when the user asks to plan a milestone, write or revise a roadmap plan, plan the next milestone, resolve milestone open questions, create a plan under docs/roadmaps, or start coordinating execution of an existing milestone plan.
---

# MM Plan

## Purpose

Use this skill to produce or maintain a milestone plan for this repository.
Milestones say what and why; plans say how to deliver one milestone through
PR-sized tasks, resolved open questions, dependencies, wave planning, and
agent recommendations.

Follow the repo `AGENTS.md` first. This skill is the Codex-native version of
the old Cursor `/plan` workflow; do not require Cursor command files to be
present or loaded.

## Inputs

Before editing a plan:

1. Identify the active roadmap under `docs/roadmaps/`.
2. If the user did not name a milestone, ask which milestone to plan before
   editing files.
3. Read the relevant milestone doc end-to-end.
4. Read `docs/roadmaps/PLAN_TEMPLATE.md`.
5. If revising or executing an existing plan, read that plan too.
6. Read the roadmap status when the plan needs to link back to roadmap state.

Keep implementation work out of scope while writing or revising a plan unless
the user explicitly asks to execute the plan.

## Plan Location

Create new plans at:

```text
docs/roadmaps/<YYYY-MM-DD> <roadmap-name>/plans/<YYYY-MM-DD> <milestone-id>-<slug>.md
```

Use the current date from the environment for the leading date. Include the
milestone identifier from the milestone filename, such as `04f` from
`04f-tag-colors-and-graph-tag-config.md`. Preserve old plans as historical
records; create a new dated plan when replacing an approach.

## Required Sections

Use the plan template structure. Every plan must include, in order:

1. Header: created date, author, milestone link, status, total effort.
2. Summary: one or two sentences.
3. Open questions resolved: every milestone open question with a bold decision
   and one-sentence rationale.
4. Out of scope: what this plan deliberately defers.
5. Tasks: PR-sized units of work.
6. Wave plan: explicit parallelization.
7. Risks and rollback.
8. Definition of Done for this plan.
9. Notes: dated scratchpad entries.

Avoid copying milestone scope or acceptance criteria wholesale. Link to the
milestone and add only task-specific checks where the plan needs detail.

## Task Fields

Every task must include all fields below:

| Field | Requirement |
| --- | --- |
| ID | `T01`, `T02`, and so on, unique within the plan |
| Title | Imperative, one line |
| Depends on | Other task IDs, or `-` if none |
| Wave | Integer; same-wave tasks can run in parallel |
| Agent | Lowest-cost reliable agent class for the task |
| Effort | `XS` around 30 min, `S` around 2 h, `M` around half day, `L` around full day or split |
| Files | Expected files or directories touched |
| PR title | Conventional Commits format |
| Acceptance | Concrete behaviors and validation checks |

Split any task that feels bigger than `L`.

## Open Questions

Resolve every open question from the milestone. Prefer a clear decision backed
by codebase context. If user input is genuinely required, leave an `ASK USER:`
marker in the plan and surface the same question in chat.

Do not guess on product direction, irreversible architecture, or UX behavior
that the milestone intentionally leaves to the user.

## Wave Planning

Tasks in the same wave must have all dependencies satisfied by prior waves and
must not require edits to the same file unless the edits are clearly
independent. Move conflicting tasks to separate waves or split the shared file
work first.

Use a compact wave summary, for example:

```text
Wave 1   T01
Wave 2   T02
Wave 3   T03  |  T04
Wave 4   T05
```

Before starting a wave during execution, verify every task in that wave has all
`Depends on` items already completed or merged.

## Agent Selection

Pick the lowest-cost agent class that can do the task reliably:

| Agent class | Best for |
| --- | --- |
| Fast / cheap | Mechanical edits, formatting, docs tweaks, trivial type additions |
| Default workhorse | Typical feature implementation with tests and normal refactors |
| High-reasoning | Architecture, hard debugging, layered refactors, novel algorithms |
| Read-only explore subagent | Surveys and codebase mapping that should not edit files |
| General-purpose subagent | Multi-step work that mixes research with edits |
| Best-of-n runner | Comparing multiple plausible algorithmic approaches |
| Shell subagent | Long shell-heavy sessions, git plumbing, bulk renames, dependency upgrades |

If exact model names are not known in the current Codex environment, name the
agent class rather than inventing model identifiers.

## Authoring Workflow

When writing a plan from scratch:

1. Copy the template into the active roadmap's `plans/` directory.
2. Fill the header and link the milestone.
3. Resolve all milestone open questions.
4. List out-of-scope items.
5. Decompose the milestone into PR-sized tasks with all required fields.
6. Build the wave plan and check same-wave file conflicts.
7. Add risks, rollback, and plan-specific Definition of Done.
8. Set status to `draft` unless the user specifically asks otherwise.
9. Run `pnpm --filter mind-map-sv lint` to catch formatting issues.
10. Report the plan path and any `ASK USER:` items.

Do not start implementation after authoring a plan unless the user explicitly
asks for execution.

## Execution Workflow

When the user asks to execute an entire plan:

1. Set the plan status to `executing` when wave 1 starts.
2. Coordinate work by wave. Use available Codex subagent, thread, or worktree
   tools when practical for parallel tasks.
3. Open or prepare one logical PR per task when that is part of the requested
   workflow. Use the task's `PR title`.
4. Update the plan as reality changes; do not let the plan diverge from the
   implementation.
5. After the final task lands and validation passes, update the plan status,
   milestone status, and roadmap row as appropriate.
6. Commit completed logical changes unless the user explicitly asked not to.

If subagent or PR tooling is unavailable, explain the limitation and ask before
flattening a multi-wave execution plan into a single-agent implementation.
