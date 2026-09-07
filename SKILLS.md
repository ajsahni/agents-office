# Teaching the agents how you work

Out of the box an agent knows three things: its one-line job description, your notes, and a
house rule to hand over a finished deliverable. That gets you a competent generic answer. It does
not get you *your* proposal, *your* client reply, *your* weekly report. For that you tell the
agent how the work is done, and there are two ways to do it.

| | A brief | A skill |
|---|---|---|
| What it is | A few standing sentences on one agent | A folder: how one kind of work is done, plus templates and examples |
| Lives in | `office.agents.local.json`, or `<brain>/Agents Office/agents.json` | `<brain>/Agents Office/skills/<name>/` |
| Read when | Every task and chat turn for that agent | Every task and chat turn for the agents it is bound to |
| Good for | Tone, red lines, who to escalate to, a preferred tool | A repeatable job with steps, a shape, rules and a template |
| Size | Up to 2,000 characters | SKILL.md up to 6,000 characters, plus up to 8,000 in files beside it |

Use a brief when it fits in a paragraph. Use a skill when you would hand a new hire a document.
Both can be written by hand or by Claude Code in this folder (see the end of this page).

## Briefs

Add a `brief` to any agent. It is read before every task and every chat turn.

```json
{ "agents": [
  { "id": "piper",
    "brief": "Every proposal has three options and we recommend the middle one. Prices ex GST, per month. Never discount: a cheaper option is a smaller scope. If a client asks for something the offer ladder does not have, quote it as (price to confirm) and flag it to me." }
] }
```

A brief can be a list of lines instead of one string. Restart the office after changing briefs.

## Skills

A skill is a folder with a `SKILL.md` and anything the agent needs beside it. It is the same shape
as a Claude Code skill, so if you have written one of those you already know this.

```
<brain>/Agents Office/skills/
  proposal/
    SKILL.md          ← what, when, the steps, the rules
    template.md       ← the shape of the finished thing
    example.md        ← one real one you were happy with
```

`SKILL.md` starts with a front-matter block, then the instructions in plain Markdown:

```markdown
---
name: proposal
description: How we write a client proposal
agents: [piper]
---
# Writing a proposal

Use this for any request that ends in a document a client says yes or no to.

## Before you write
1. Find the client in `30-Customers`. If they are not there, say so at the top.
2. Take packages and prices from `10-Business/offer-ladder.md`. Never invent a price.

## The shape
Follow `template.md` beside this file, section for section.

## Rules
- Three options, always. Recommend the middle one.
- One page. If it will not fit, cut the background, not the scope.
```

**Binding.** `agents: [piper]` binds it to one or more agents by id (the ids are in
`office.agents.json`). `departments: [emails]` binds it to every agent in a department. Neither
means every agent gets it, which is right for a house style and wrong for almost anything else.
A skill whose agents or departments are all misspelt is skipped, and `npm run check` says so.

**Files beside SKILL.md.** Agents have no file tools, so every readable file in the folder
(`.md`, `.txt`, `.csv`, `.json`, `.yaml`, `.html`) is placed in front of the agent with the skill.
Other files are listed by name only. Keep the folder to what the agent needs: a template, one or
two examples, a checklist. Not the whole archive.

**Where.** Your skills go in `<brain>/Agents Office/skills/` (the brain is the folder named in
`office.config.json`). They live with your notes, they are backed up with your notes, and
`git pull` never touches them. The repo's own `skills/` folder holds three examples for the
sample studio; a skill of the same name in your brain replaces the shipped one.

**When it takes effect.** Immediately. Skills are re-read from disk before every task and chat
turn. `npm run check` validates them; http://localhost:4520/api/skills shows what is loaded and
who has what.

## What the agent sees

For a task, the agent's instructions are assembled in this order:

1. Who it is: name, role, what it does.
2. Its brief, if it has one.
3. Every skill bound to it, in full, with the files beside each one.
4. The tools it may call.
5. Your brain's `CLAUDE.md`, `index.md`, `business-model.md` and `voice.md`, if present.
6. The notes it picked for this task.

A skill or a brief overrides the default shape (short, under 260 words). The deliverable ends
with a line naming the skill it followed, and the note saved in your brain records it in its
front matter, so you can see later which work was done to which skill.

The router also sees each agent's skill names, so a task that reads "draft the proposal for
Harbourside" lands on the agent who owns the proposal skill.

## Writing a good one

- **Say when.** The first line after the heading is the trigger: "Use this for any request that
  ends in a document a client says yes or no to." The agent matches tasks to skills by this.
- **Steps, then shape, then rules.** What to read first, what the finished thing looks like, what
  is never allowed. A template file beats a description of a template.
- **Point at notes by name.** "Prices come from `10-Business/offer-ladder.md`" makes the agent go
  and read it. "Use our pricing" does not.
- **One real example.** An `example.md` of one you were happy with does more than a page of
  adjectives.
- **Keep the red lines short and absolute.** "No discounts." "Nothing outbound without the owner."
- **One skill per kind of work.** A proposal skill, a client reply skill, a weekly report skill.
  Not one giant "sales" skill.

## Turning what you already have into a skill

Most businesses already have the material: an SOP in a Word doc, an email you keep copying, a
report you built last quarter, a checklist on the wall. The fastest route is to give that to
Claude Code in this folder and let it write the skill.

```
claude
> Here is the proposal I sent Harbourside and was happy with (paste, or point at the file).
  Turn it into a skill for the Proposals agent: the shape as a template, the rules I follow,
  and keep this one as the example.

> Our client-reply rules are in ~/Documents/support-sop.docx. Make it a skill for the whole
  Emails department.

> Every Monday I want a one-page ops report: last week's deliveries, anything late, this
  week's risks. Make a skill for Internal Reporting that produces exactly that.
```

Claude reads `CLAUDE.md`, asks what it does not know, writes the folder into your brain's
`Agents Office/skills/`, binds it to the right agent, and runs `npm run check`. Then give the
agent the task and read the result. Send it back with `revise: …` from the chat and, when the
correction is one you will want every time, fold it into the skill.

## Checking it worked

- `npm run check` lists every skill, who it is bound to, and every problem in plain sentences.
- `npm start` prints the count at boot; http://localhost:4520/api/skills shows the detail.
- Give the agent a task the skill covers. The deliverable ends with `Skill: <name>`.
- Open the saved note in `<brain>/Agents Office/`. Its front matter has `skills:`.

## Limits and rules

- `SKILL.md` over 6,000 characters is trimmed; files over 4,000 characters each or 8,000 in total
  per skill are trimmed or listed by name. Long material belongs in your notes, where the agent
  reads it when the task calls for it.
- Skills are instructions, not tools. An agent with a Gmail skill still needs Gmail connected
  in Claude Code and allowed in `office.config.json`.
- Skills cannot add agents, change departments or grant tools. They say how, not who.
- A skill does not override the standing rule: read freely; send, post, pay, delete or change
  anything outside this machine only when the task explicitly asks for that exact action.
