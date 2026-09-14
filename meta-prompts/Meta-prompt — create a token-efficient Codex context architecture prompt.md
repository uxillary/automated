I want to permanently optimise how Codex works inside this project's repository so future Codex tasks use much less context and fewer tokens.

Please create a **ready-to-paste Codex prompt** that will perform a one-time repository context optimisation similar to this:

- create or improve a concise root `AGENTS.md`;
- create a compact `codex/REPO-MAP.md`;
- create a compact `codex/CONTEXT.md`;
- move large audits/history/reference material into `codex/archive/`;
- identify folders/files Codex should normally avoid inspecting;
- add progressive repository exploration rules;
- add large-file handling rules;
- add targeted validation rules;
- reduce unnecessary broad repo exploration;
- preserve useful project knowledge without loading it on every future task.

The goal is to make future Codex runs use the **minimum sufficient context**, rather than scanning the repository broadly.

Before writing the Codex prompt, use the project context available in this ChatGPT Project to tailor it to this specific repository.

If GitHub access is available and current repository structure matters, inspect the repository **narrowly** first:
- root structure;
- existing `AGENTS.md`;
- existing `codex/` or context docs;
- package/config manifests;
- first-level source directories;
- obvious generated/build folders.

Do NOT perform a full repo audit just to create the prompt.

## What the Codex prompt should achieve

The prompt you produce should instruct Codex to:

### 1. Build a small context architecture

Prefer something like:

```text
AGENTS.md

codex/
├── REPO-MAP.md
├── CONTEXT.md
├── focused roadmap/task docs
└── archive/
    └── historical audits/reference docs
```

Adapt this to the actual repo instead of blindly forcing this exact structure.

Keep the permanent context system small.

### 2. Make `AGENTS.md` the behavioural controller

It should tell future Codex sessions to:

1. read `AGENTS.md`;
2. read `codex/REPO-MAP.md`;
3. use `codex/CONTEXT.md` only when broader context is needed;
4. start with files named in the user's task;
5. use targeted search/import tracing;
6. inspect only direct dependencies;
7. stop exploring once enough context exists.

Include rules against:
- routine whole-repo scans;
- recursive directory exploration without reason;
- rereading large historical docs;
- unrelated cleanup/refactors;
- reading generated/build output;
- loading large assets/binaries;
- inspecting unrelated subsystems "just in case."

### 3. Add progressive context expansion

Use this principle:

`task → repo map → named/obvious files → direct dependencies → targeted search → wider subsystem only if needed → whole repo only when justified`

Make this the default repository exploration behaviour.

### 4. Add a practical initial scope heuristic

For normal tasks, aim to understand the task using roughly:
- the repo map;
- explicitly named files;
- around 3–8 directly relevant source files.

This is a heuristic, not a hard cap.

Codex can expand when real dependencies require it.

### 5. Create a concise repo map

`codex/REPO-MAP.md` should explain:
- important directories;
- major routes/features/subsystems;
- where UI/components/styles/content/tests/config live;
- when each area should be inspected;
- which areas usually do not need to be inspected;
- useful route-to-file or feature-to-directory mappings.

Do NOT list every file.

The purpose is to prevent future Codex sessions from rediscovering the repo structure repeatedly.

### 6. Create concise durable project context

`codex/CONTEXT.md` should contain only durable information that helps across many tasks, such as:
- what the project is;
- technology stack;
- major architecture;
- design/UX principles;
- product direction;
- accessibility expectations;
- SEO/content philosophy where relevant;
- development conventions.

Do NOT turn it into project history.

Keep it deliberately small.

### 7. Archive heavyweight context

Large audits, old planning docs, historical analysis and similar files should move into `codex/archive/` or equivalent cold storage where appropriate.

Future Codex sessions should be told:
- do not read archive files by default;
- only use them when explicitly relevant;
- search/read only relevant sections when possible.

Preserve useful historical information rather than deleting it blindly.

If duplicate audit/context files exist, consolidate safely where sensible.

### 8. Identify default-ignore areas

Using the actual repository, identify paths Codex should normally ignore unless specifically needed.

Examples may include:
- `node_modules/`
- `.next/`
- `dist/`
- `build/`
- `coverage/`
- generated files
- static asset collections
- fonts/videos/binaries
- cache directories
- framework build output
- deployment tooling
- historical docs
- secret/environment files

Do NOT blindly copy these examples. Verify what actually exists in the repo.

Phrase them as behavioural defaults, not absolute technical restrictions.

### 9. Protect secrets

Future Codex sessions should not inspect secret-bearing `.env` files unless the task explicitly requires environment configuration.

Safe example/config files may be inspected when relevant.

Never expose secret values in output.

### 10. Add large-file rules

Before fully reading large Markdown, JSON, logs, generated source or data files:
- determine whether the whole file is needed;
- prefer search/headings/target ranges;
- inspect only relevant sections where possible.

### 11. Add targeted validation guidance

Future Codex tasks should prefer:
- affected tests;
- relevant lint/typecheck;
- focused builds where warranted;
- browser/responsive checks for UI work.

Do not fix unrelated warnings unless requested.

Distinguish pre-existing issues from regressions.

### 12. Consider nested `AGENTS.md` only if useful

Do not scatter instruction files everywhere.

Prefer:
- root `AGENTS.md`;
- repo map;
- context file.

Only create nested `AGENTS.md` files for major subtrees when they materially reduce ambiguity/context usage.

### 13. Avoid over-engineering

The optimisation system itself should not become large.

Prefer a few small durable files over many overlapping instruction docs.

Avoid duplicating the same rules across files.

### 14. Check obvious tracked/generated clutter

Briefly identify generated/build outputs that appear to be tracked unnecessarily.

Do NOT remove them automatically unless it is clearly safe and within scope.

Report questionable items separately.

### 15. Final sanity check

Ask Codex to mentally test whether the repo map would efficiently guide several common project tasks, such as:
- a UI component change;
- a bug fix;
- a content update;
- a build/config issue;
- a historical/audit lookup.

The system should guide Codex toward a small relevant subset of the repo for each.

## Important constraints for the Codex prompt you create

The prompt itself must tell Codex:

- this is NOT a full repository audit;
- do not recursively inspect the repo;
- inspect only enough structure to build a useful map;
- do not modify application functionality;
- do not perform unrelated cleanup;
- keep the new context docs concise;
- token/context efficiency is the primary goal.

## Tailoring

Do not give me a generic template if you already know useful details about this project.

Use the current project context to tailor:
- likely source directories;
- framework/build folders;
- content areas;
- project-specific design/development rules;
- existing context/audit files;
- any important repo conventions.

If some details are uncertain, instruct Codex to verify them narrowly rather than assuming.

## Output format

Give me:
1. one complete ready-to-paste Codex prompt;
2. optionally, a short note after it explaining any repo-specific choices you made.

Do not execute the repo optimisation yourself unless I explicitly ask you to.