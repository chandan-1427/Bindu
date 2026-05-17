# Skills

Reusable skill definitions that example agents reference by id. Each subfolder is one skill — a `skill.yaml` declaring the skill's id, name, version, tags, input/output modes, and example prompts. Bindu reads these at boot when an agent's `config["skills"]` lists a path to one.

```yaml
id: cbt-drafter-v0
name: cbt-drafter
version: 0.1.0
description: |
  Drafts a CBT (Cognitive Behavioral Therapy) exercise from a user statement.
tags: [cbt, mental-health, drafting]
input_modes: [text/plain]
output_modes: [application/json]
```

The skills here:

| Folder | Used by |
| --- | --- |
| `cbt-drafter/` | `examples/cerina_bindu/cbt/` |
| `cbt-safety-guardian/` | `examples/cerina_bindu/cbt/` |
| `cbt-clinical-critic/` | `examples/cerina_bindu/cbt/` |
| `cbt-supervisor-orchestrator/` | `examples/cerina_bindu/cbt/` |
| `zk-policy/` | Demo skill for the private-skills surface. |

Most example agents embed their skill files directly (e.g. `examples/summarizer/skills/text-summarization-skill/skill.yaml`); these are the ones that are genuinely shared across multiple examples.

For the skill schema and how agents load skills, see [`docs/SKILLS.md`](../../docs/SKILLS.md).
