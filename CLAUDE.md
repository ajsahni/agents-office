# Agents Office — for Claude Code

You are in the Agents Office repo. The owner will most often ask you to change **who the agents are and what they do**, or to change **which connectors the agents may use**. Do that by editing the two JSON files below. Do not touch `src/`, `serve.mjs` or the build for those requests.

## Changing the agents

The roster lives in `office.agents.json` (shipped defaults) and `office.agents.local.json` (the owner's copy, ignored by git). **Always write to `office.agents.local.json`**: if it does not exist, create it with `{"agents": []}` and add only the agents you are changing. Never edit `office.agents.json` unless asked to change the shipped defaults.

Each agent looks like:

```json
{ "id": "newt", "department": "marketing", "lead": false,
  "name": "NEWSLETTER", "role": "Newsletter Creator Agent",
  "does": "Writes the monthly newsletter your signups actually open.",
  "tools": ["beehiiv", "loops"] }
```

You may change **name, role, does, tools**. Keep `name` short and upper case (it is the label on the desk). `does` is what the agent reads about itself before every task, so write it as a job description in one or two sentences. `tools` names the connectors this agent usually reaches for (match the names shown in the top bar, lower case).

Fixed, and the office ignores edits to them: `id`, `department`, `lead`. There are **six departments and 33 seats** and that is the office. Do not add or remove agents, departments or pods. When the owner wants a new kind of agent, **rename a seat** in the right department. When they want fewer, leave the seat as is; an idle agent costs nothing.

Department keys: `emails` (5 seats) · `sales` (6) · `marketing` (6) · `ops` (5) · `fin` (4) · `delivery` (7). The lead of each department stays the lead.

After editing: run `npm run check` (it validates the roster and prints every problem), then tell the owner to restart the office (`npm start`). Names, roles and descriptions update on the next page load.

## Changing the connectors

The top bar shows the MCP servers **this machine's Claude Code** is connected to (`claude mcp list`). To add one: `claude mcp add …` or connect it in claude.ai; the office picks it up on restart. To decide what the agents may call, edit `office.config.json` (or `office.config.local.json`):

```json
"mcp": {
  "allow": [],
  "deny": ["Stripe"],
  "departments": { "Slack": ["emails", "ops"] }
},
"tools": { "web": true }
```

`allow` empty means every connected server. `deny` keeps a server in the bar but out of the agents' hands. `departments` says which pods a server is wired to; unknown servers default to every pod. `tools.web` gives the agents web search.

Agents get only connected servers (plus web when enabled). They never get Bash, file tools or sub-agents. Their standing rule: read freely; send, post, pay, delete or change data outside this machine **only** when the owner's task explicitly asks for that exact action.

## Everything else

- `npm run check` is the loop. Run it after any change to code; fix what is red.
- `README.md` says what the product does. Keep it true to the code.
- Release: `node scripts/release.mjs --push` (owner only).
