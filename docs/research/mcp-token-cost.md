# What an MCP server costs in tokens (Claude Code)

Research date: 2026-09-29. Target: the MoI MCP server (11 tools: `delete_objects`,
`export_objects`, `get_scene`, `get_selection`, `get_view`, `moi_eval`, `moi_factory_help`,
`set_selection`, `set_units`, `set_view`, `set_viewport_layout`).

Sources are primary only: Claude Code docs (code.claude.com), Anthropic API docs
(platform.claude.com, formerly docs.claude.com), and the MCP spec (modelcontextprotocol.io).
Every claim carries its URL. Anything I could not confirm is marked **unconfirmed**.

Short URLs used below:

- MCP = https://code.claude.com/docs/en/mcp
- COSTS = https://code.claude.com/docs/en/costs
- CACHE-CC = https://code.claude.com/docs/en/prompt-caching
- ENV = https://code.claude.com/docs/en/env-vars
- OTEL = https://code.claude.com/docs/en/monitoring-usage
- CMDS = https://code.claude.com/docs/en/commands
- TOOLS-API = https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- TSEARCH-API = https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- CACHE-API = https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- COUNT-API = https://platform.claude.com/docs/en/build-with-claude/token-counting

---

## 1. Eager or deferred loading

**Deferred is the default.** "Tool search keeps MCP context usage low by deferring tool
definitions until Claude needs them. Only tool names and server instructions load at session
start." ([MCP, "Scale with MCP tool search"](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search))
The costs page says the same: "only tool names and server instructions enter context until
Claude uses a specific tool" ([COSTS, "Reduce MCP server overhead"](https://code.claude.com/docs/en/costs#reduce-mcp-server-overhead)).

**When the full schema loads.** Claude searches through the `ToolSearch` tool. The API returns
`tool_reference` blocks (5 by default) and "automatically expands these references into full tool
definitions" inline in the conversation. The system-prompt prefix is untouched, so caching is kept
([TSEARCH-API, "How tool search works" and "Deferred tool loading"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#how-tool-search-works)).
The search matches tool names, descriptions, argument names and argument descriptions (same page).
Once discovered, a tool stays usable for later turns without re-searching (same page, "Continuing the conversation").

**Control: `ENABLE_TOOL_SEARCH`** ([MCP, "Configure tool search"](https://code.claude.com/docs/en/mcp#configure-tool-search)):

| Value | Behavior |
| :- | :- |
| unset | All MCP tools deferred. Falls back to upfront loading on a non-first-party `ANTHROPIC_BASE_URL`, older Google Cloud Agent Platform models, or Foundry deployments hosted on Azure |
| `true` | All deferred (still upfront where the platform rejects it) |
| `auto` | Threshold mode: load upfront while the would-be-deferred definitions total under **10% of the context window**; defer all once they reach 10% |
| `auto:N` | Same with a custom percentage, N = 0-100 |
| `false` | All MCP tools loaded upfront |

Other switches on the same page:

- `alwaysLoad: true` in a server's config loads every tool of that server at session start
  regardless of `ENABLE_TOOL_SEARCH`. A single tool can opt in with `"anthropic/alwaysLoad": true`
  in its `_meta`.
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` keeps tool search off and `ENABLE_TOOL_SEARCH` cannot
  override it.
- Tool search needs a model with `tool_reference` support (Sonnet 4.5, Haiku 4.5, Opus 4.5 and later).

The deferred list that stays in context is "tool names" ([MCP](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)).
Whether descriptions are also listed is **unconfirmed**; the docs say "names".

## 2. The server `instructions` field

- It is an optional string in the MCP `initialize` response
  ([MCP spec, lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)).
  I found no size limit in the spec text I fetched. (A full read of the schema page was not
  possible; treat "no spec-level limit" as **unconfirmed**.)
- Claude Code loads it at session start even when tools are deferred ("Only tool names and server
  instructions load at session start", [MCP](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)).
  So it is a fixed per-session cost, and it sits in the system-prompt layer
  ([CACHE-CC, "How the cache is organized"](https://code.claude.com/docs/en/prompt-caching#how-the-cache-is-organized)).
- **Limit:** "Claude Code truncates each tool description and each server's instructions at 2,048
  characters by default. Keep them concise, and put critical details near the start." Override with
  `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` (v2.1.280+)
  ([MCP, "For MCP server authors"](https://code.claude.com/docs/en/mcp#for-mcp-server-authors);
  [ENV](https://code.claude.com/docs/en/env-vars)).
- The docs' advice: instructions "help Claude understand when to search for your tools"
  ([MCP](https://code.claude.com/docs/en/mcp#for-mcp-server-authors)).

## 3. How tokens are counted

**Tool definitions.** Billed as ordinary input tokens: "the total number of input tokens sent to
the model (including in the `tools` parameter)". Sources of extra tokens: the `tools` parameter
(names, descriptions, schemas), `tool_use` blocks, and `tool_result` blocks
([TOOLS-API, "Pricing"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#pricing)).
When any tool is present the API adds a tool-use system prompt: 286 tokens on Sonnet 5.5 and Opus
5.5 with `tool_choice` auto/none (same table; other models 264-675).

**Tool calls.** `tool_use` blocks Claude writes are output tokens; when re-sent in history they are
input tokens (same page, "Pricing"; billing split by input/output is stated there).

**Tool results.** `tool_result` blocks are input tokens on that request and on every later request
while they stay in history (same page; [COSTS, "Why usage climbs"](https://code.claude.com/docs/en/costs#why-usage-climbs-in-a-long-session):
"Claude Code sends your full conversation with every request").

**Deferred tools.** Definitions loaded by search "count as input tokens like any other tool
definition"; tool search is not metered separately
([TSEARCH-API, "Usage"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#usage)).
The full definitions are still sent in the request body each time, but only expanded into model
context on discovery (same page, "Deferred tool loading").

**Tokenizer.** Claude 4.7 and later use a tokenizer producing "approximately 30 percent more
tokens" than earlier models for the same text; recount against the target model
([COUNT-API](https://platform.claude.com/docs/en/build-with-claude/token-counting)).

**`MAX_MCP_OUTPUT_TOKENS`** applies to MCP results
([MCP, "MCP output limits and warnings"](https://code.claude.com/docs/en/mcp#mcp-output-limits-and-warnings)):

- Warning when a tool's output exceeds **10,000 tokens** (fixed, not configurable).
- Default maximum **25,000 tokens**; raise with `MAX_MCP_OUTPUT_TOKENS`.
- Applies to tools that do not declare their own limit. A tool that sets
  `_meta["anthropic/maxResultSizeChars"]` uses that value for text (hard ceiling 500,000
  characters). Image results always stay subject to `MAX_MCP_OUTPUT_TOKENS`.
- How Claude Code estimates "tokens" for this check (exact tokenizer or a characters heuristic) is
  **unconfirmed**.

## 4. Pricing: cache, plans, USD

**Cache multipliers** ([CACHE-API, "Pricing"](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing)):

- 5-minute cache write: 1.25 x base input price.
- 1-hour cache write: 2 x base input price.
- Cache read: 0.1 x base input price. Exceptions in the table footnote: Opus 5.5 at 0.05 x;
  Fable 5.1 and Mythos 5.1 at 0.025 x.
- Prefix order is `tools`, `system`, `messages`. "Modifying tool definitions (names,
  descriptions, parameters) invalidates the entire cache" (same page).
- Minimum cacheable prompt: 512 tokens for Sonnet 5.5 and Opus 5.5 (same page). Shorter prompts are
  processed uncached, with no error.

**In Claude Code** ([CACHE-CC](https://code.claude.com/docs/en/prompt-caching)):

- Tool definitions sit in the system-prompt layer; a changed tool set invalidates the cache.
- With deferral on, Claude Code "keeps the tool list from the conversation's first request for the
  whole conversation", so a server connecting mid-session does not break the cache. With tools
  loaded upfront, adding or removing a definition invalidates it ("Connecting or removing an MCP
  server").
- Cache lifetime: one hour for the main conversation on a subscription within plan usage; five
  minutes on API key, cloud provider, or once drawing on usage credits ("Which TTL each request
  gets"). Subagents and compaction get five minutes by default.

**Notional USD.** `/usage` computes dollars locally "from token counts at list price". It is "an
estimate, so for authoritative billing see the Usage page in the Claude Console". On Pro and Max
"usage is included in their subscription, so the session cost figure isn't relevant for billing
purposes" ([COSTS, "Using the /usage command"](https://code.claude.com/docs/en/costs#using-the-usage-command)).
API-key users are billed per token.

**5-hour window.** For Team and Enterprise, usage "draws from a per-seat allowance that resets on a
rolling five-hour window and a weekly window", shared with Claude chat and Cowork
([COSTS, "Claude for Teams and Enterprise"](https://code.claude.com/docs/en/costs#claude-for-teams-and-enterprise)).
Usage inside the allowance "isn't metered in dollars" (same section).
**Unconfirmed:** the exact token-to-window conversion (for example whether cache reads count at
0.1 x toward the window) and the window rules for Pro and Max. The pages I could fetch do not
publish a formula. What is documented: long context and cache misses are the usual reasons usage
climbs, and `/usage` flags behaviors that account for 10% or more of recent usage.

## 5. How to measure

| Tool | What it shows | Source |
| :- | :- | :- |
| `/context` | Colored grid of current context use, with suggestions for context-heavy tools. `/context all` expands the per-item breakdown | [CMDS](https://code.claude.com/docs/en/commands) |
| `/usage` (aliases `/cost`, `/stats`) | Session block: tokens by model (input, output, cache read, cache write) and a local list-price dollar estimate. A `Prompt cache (main)` line (v2.1.251+) gives hit share and misses, and can name a cause such as "tool definitions changed" (v2.1.260+). On plans, an attribution breakdown per MCP server (counts only requests that consumed one of its tool results) | [COSTS](https://code.claude.com/docs/en/costs#using-the-usage-command) |
| `/mcp` | Configured servers; disable ones not in use | [COSTS](https://code.claude.com/docs/en/costs#reduce-mcp-server-overhead) |
| `POST /v1/messages/count_tokens` | `input_tokens` for a request including `tools` and `system`. Free, rate limited by usage tier (5,000 to 20,000 RPM). An estimate; no caching logic; server tools and the MCP connector are rejected | [COUNT-API](https://platform.claude.com/docs/en/build-with-claude/token-counting) |
| OpenTelemetry | `claude_code.token.usage` with `type` = `input`, `output`, `cacheRead`, `cacheCreation`; `claude_code.cost.usage`; per-tool-result `tool_result_size_bytes` and `tool_input_size_bytes` on the tool result event. Enable with `CLAUDE_CODE_ENABLE_TELEMETRY=1` plus an exporter | [OTEL](https://code.claude.com/docs/en/monitoring-usage) |
| `claude -p "hello" --output-format json` | `usage.cache_creation` split into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` | [CACHE-CC](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself) |

Whether `/context` lists deferred MCP tool names as a separate line item is **unconfirmed** from
prose. The interactive context-window page does show an "MCP tools (deferred)" entry
([context window](https://code.claude.com/docs/en/context-window)).

---

## What this means for the MoI MCP server

1. **Baseline cost is small by default.** With tool search on (the default), a session pays for 11
   tool names plus the server `instructions` text, not 11 full schemas
   ([MCP](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)). The full schemas cost
   nothing in context until Claude searches for a tool.
2. **`instructions` is the one fixed, always-paid item.** It is loaded every session and capped at
   2,048 characters (about 500 tokens at the usual rule of thumb; that ratio is not documented,
   so measure it). Put the routing hints first ("use `moi_eval` for scripting, call
   `moi_factory_help` before writing MultiPipe2 scripts") because anything past 2,048 characters
   is dropped.
3. **Each tool description is also capped at 2,048 characters** (same source). The long
   `moi_eval` host-trap list is at risk: whatever falls past the cap never reaches the model. Keep
   critical text early, or move detail into `moi_factory_help`, whose output is paid only when
   called.
4. **A loaded schema is paid on every later request, at cache-read price.** Once `moi_eval` is
   discovered, its definition stays in the conversation and is re-read each turn at 0.1 x base input
   (0.05 x on Opus 5.5) if the cache is warm, and at 1.25 x (5m) or 2 x (1h) on the request that writes it
   ([CACHE-API](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing)).
   Smaller schemas help every turn after the first.
5. **Do not rewrite tool text mid-session.** With tool search the tool list is frozen at the first
   request, but on setups that load upfront (`ENABLE_TOOL_SEARCH=false`, custom
   `ANTHROPIC_BASE_URL`, `auto` below threshold) a changed definition invalidates the whole cache
   ([CACHE-CC](https://code.claude.com/docs/en/prompt-caching#connecting-or-removing-an-mcp-server)).
   Keep definitions static: no per-call dynamic text in descriptions.
6. **Results are the real variable cost.** `get_scene`, `get_view` (images) and `moi_eval` return
   data that stays in history and is re-sent every turn
   ([COSTS](https://code.claude.com/docs/en/costs#why-usage-climbs-in-a-long-session)). The
   10,000-token warning and 25,000-token cap apply
   ([MCP](https://code.claude.com/docs/en/mcp#mcp-output-limits-and-warnings)); image output is
   always subject to the cap. Return compact summaries, paginate `get_scene`, and prefer small
   images. If a tool must return large text, `anthropic/maxResultSizeChars` (ceiling 500,000
   characters) raises the limit for that tool only.
7. **`alwaysLoad` is a trade.** It saves one search step for hot tools (for example `moi_eval`) at
   the price of their schemas in every session. With 11 tools it is likely cheaper to leave the
   default, but the size is unmeasured; see the recipe.
8. **Subscription users see no dollar cost**, only plan-window use. `/usage` dollars are a list-price
   estimate ([COSTS](https://code.claude.com/docs/en/costs#using-the-usage-command)). The
   token-to-window conversion is unpublished (unconfirmed), so document token counts, not USD
   promises.

## How to measure (recipe)

1. **Baseline:** start a fresh session with no other servers, run `/context`, note the MCP line.
   Repeat with `ENABLE_TOOL_SEARCH=false` to see the upfront cost of all 11 schemas plus
   instructions; the difference is what deferral saves.
2. **Exact schema size:** export the server's `tools/list` result (an MCP inspector or a small
   client script), then send it as `tools` (with `input_schema`) to `POST /v1/messages/count_tokens`
   using the model you actually run. Send once with tools and once without; the difference is the
   definitions cost ([COUNT-API](https://platform.claude.com/docs/en/build-with-claude/token-counting)).
   Count `instructions` the same way, as a `system` string. Remember the tool-use system prompt
   overhead (286 tokens on Sonnet 5.5) is included when tools are present.
3. **Per-call cost:** run a typical task, then `/usage`. Compare input, cache read and cache write
   before and after each MoI call.
4. **Result sizes:** enable OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, console exporter is
   enough) and read `tool_result_size_bytes` per call ([OTEL](https://code.claude.com/docs/en/monitoring-usage)).
5. **Cache health:** check the `Prompt cache (main)` line in `/usage`; a "tool definitions changed"
   cause means something is mutating the tool set mid-session.

## Measured: the MoI MCP server's tool definitions

Measured with an in-memory MCP client calling `tools/list` on the built server (11 tools, no
`instructions`). Sizes are characters of the JSON `{ name, description, input_schema }`; tokens are an
estimate at 3.5-4 characters per token, not a count. Run the recipe above (step 2) for exact numbers.

| Tool | Before (chars) | After (chars) |
|---|---|---|
| `moi_eval` | 6,623 | 1,991 |
| `export_objects` | 3,164 | 3,164 |
| `get_view` | 3,108 | 3,108 |
| `set_view` | 2,070 | 2,070 |
| `moi_factory_help` | 1,143 | 1,232 |
| `set_units` | 959 | 959 |
| `set_viewport_layout` | 954 | 954 |
| `get_scene` | 626 | 626 |
| `set_selection` | 545 | 545 |
| `delete_objects` | 547 | 547 |
| `get_selection` | 348 | 348 |
| **Total** | **20,087 (about 5,000-5,700 tokens)** | **15,544 (about 3,900-4,400 tokens)** |

- Before the change, `moi_eval`'s description was 6,324 characters. Claude Code cuts each tool
  description at 2,048 characters, so most of the host-trap list and the no_units / command_running
  notes at its end never reached the model.
- The traps and helper details now live in `moi_factory_help('traps')` and
  `moi_factory_help('helpers')`: they cost tokens only in the session that asks for them.
- A test (`every tool description ... fits Claude Code's 2,048-character cap`) fails if any
  description, refusal notes included, grows past the cap.
- Not yet measured: per-call result sizes, and `/context` output on a live session.
