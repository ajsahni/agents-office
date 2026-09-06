# Changelog

## 3.0.0-beta.3 — 6 Sep 2026

- No more "demo" label: the panel shows LIVE · CLAUDE when the server is connected and nothing otherwise.

## 3.0.0-beta.2 — 6 Sep 2026

- The Brain strip is gone from the task panel. Open the Brain with G, by clicking the pod, or by its tag.

## 3.0.0-beta.1 — 6 Sep 2026

Agents Office v3 (Beta): the V3 office as a real, installable app.

- Six departments, 33 agents, each with a role, a voice and a task pool.
- Task Status panel with a command bar: type a task, pick the department, the office routes it to the right agent through Claude and the agent produces the deliverable, saved as a note in your brain folder.
- The Brain is your own folder of Markdown notes with `[[wiki links]]`, drawn as a graph over the centre pod, rebuilt live as agents write. `G` opens the full graph with search and a note preview.
- Chat with any agent: real conversation in that agent's persona, grounded in your notes. `revise: …` reworks the last deliverable.
- Runs on your existing Claude Code login, or on an API key if you set one. Nothing leaves your machine except the calls to Claude.
- `npm run check` — the build loop: build, offline smoke, server smoke; `npm run check:live` adds one real task and one chat turn.


## 0.1.0 — 7 Aug 2026

First public release: daemon-based office with inboxes, approvals and an outbox.
