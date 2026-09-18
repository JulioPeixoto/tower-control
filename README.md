# Decision Arena

Four games where AI models make the same decisions side by side. Every controller gets its
own copy of **the same world from the same seed**, reads **the same text** and answers **the
same typed questions**: TypeSafe's **Jev** (a "System One" decision model) against small LLMs
(**GPT-5.6 Luna**, **Claude Haiku 4.5**, **Gemini 3.5 Flash-Lite**) and rule-based bots.

It is the visual, runnable companion to the `jev-decision-bench` research plan. Every run is
saved with each decision's latency, cost, tokens and answers.

| Game | What the controller decides | What it tests |
|---|---|---|
| **[Tower Control](#tower-control)** `/tower` | Heading, altitude, speed or landing for every aircraft | Long-horizon control, latency, raw vs computed facts |
| **[City Dispatch](#city-dispatch)** `/dispatch` | Send a unit? Which service? How urgent? | Language, calibration, pranks and injected orders |
| **[Sorting Hub](#sorting-hub)** `/sorting` | Which bay a parcel belongs in | Hierarchical decisions across the 255-option limit |
| **[Night Highway](#night-highway)** `/highway` | Left, stay or right | Reaction time; latency turned into distance |

See [`docs/jev-in-the-wild.md`](docs/jev-in-the-wild.md) for how others are testing Jev and
what shaped these games.

## Quick start

```sh
bun install
cp .env.example .env        # then set OPENROUTER_API_KEY
bun run dev                 # http://localhost:3000
```

Open the home page, pick a game, the level, seed, clock and controllers, then press **Start
match**. The bots work without an API key. A match stops by itself when its last browser tab
closes, so nothing spends credits in the background.

Every game page takes URL parameters, handy for recordings:
`/dispatch?autostart=1&level=4&seed=7&mode=realtime&speed=16&controllers=jev,luna,haiku`

## Two clocks

| Mode | While a controller thinks | Measures |
|---|---|---|
| **Turn based** | The world waits | Decision quality only |
| **Real time** | The world keeps moving; the answer lands on a newer world than the one asked about | Quality under latency |

The gap between the two is how much of a result comes from being fast rather than right.
Tower Control and Night Highway draw it: a **ghost** marks where each aircraft or the car
was when the controller last looked.

## Same questions for everyone

Every decision is a set of typed questions, the shape Jev's decisions API takes natively:

- `choice`: one of a fixed set of options
- `noul`: a probability that the answer is yes
- `score`: a level on an ordinal scale

Jev receives them as-is at `POST /api/alpha/decisions`. LLMs get the same questions, options and
wording, listed in the prompt and enforced with a strict JSON schema (`src/arena/deciders.ts`).
LLMs run with reasoning effort `none` by default.

## The games

### Tower Control
Land arrivals on two parallel runways. Emergencies (mayday, minimum fuel, medical) and runway
closures reach the controller **only as radio text**. Four `choice` questions per aircraft
(action, heading, altitude, speed). **State text: Raw / Facts**: Facts adds exact, code-computed
facts per aircraft (clearance range, whether it can still descend in time, seconds to leaving the
radar, predicted conflicts, bearing to the airport), never advice. Bots: FIFO, random.

### City Dispatch
Emergency calls arrive as transcripts. The model answers `dispatch` (noul), `service` (choice)
and `priority` (score); code sends the nearest free unit and drives it. The mix includes calm
callers with real emergencies, loud pranks, and calls that try to give the dispatcher orders.
Each panel draws a live **reliability diagram** of "send a unit" and its Brier score. Bots:
keyword matcher, oracle (knows the truth), random.

### Sorting Hub
Parcels described in free text ("about a dozen kilos", "next-day", "handle with care") must reach
the right bay of a seeded decision tree: 9, 27, 125, **343** or **625** bays. Three strategies:

- **Extract**: one call extracts the attributes, code walks the tree
- **Step by step**: one choice per junction, as the parcel reaches it
- **Flat**: one choice among every bay. Above 255 bays Jev cannot answer (`Too many choices`)

In real time a slow reader fills the intake belt and parcels are dropped. Bots: regex parser,
random.

### Night Highway
Five lanes, barrier rows and coins; each answer moves the car at most one lane, one decision per
0.5 s of game time. At 1× real time the road never waits. **State text: Raw / Facts** (seconds to
the next barrier per lane). Bots: planning autopilot (the ceiling), random.

## Headless runs

```sh
# Tower Control (its own engine)
bun run bench --level 3 --seeds 1-5 --mode turn --controllers jev,luna,haiku,fifo [--facts]

# Arena games
bun run arena --game dispatch --level 4 --seeds 1-5 --mode turn --controllers jev,luna,haiku,keyword
bun run arena --game sorting --level 3 --option strategy=stepwise --controllers jev,luna,haiku,parser
bun run arena --game highway --level 3 --option state=facts --controllers jev,autopilot

# A first pass over the three arena games with real models (~30 min, < US$1.50)
bash scripts/overnight.sh
```

Runs are written to `runs/` (Tower) and `runs/<game>/` as JSON: config, final metrics and every
decision with the sim time it was asked and applied, latency, tokens, cost and answers (for Jev
also the confidence and full distributions). `runs/` is git-ignored; copy what you want to keep.

Controllers: `jev`, `luna`, `haiku`, `flash-lite`, each game's bots, or any OpenRouter model as
`llm:<model-id>` / `jev:<model-id>`.

| Script | What it does |
|---|---|
| `bun scripts/one-decision.ts 3 42 300` | One Tower decision from each controller; `FACTS=1` for the facts text |
| `bun scripts/arena-one.ts dispatch 4 7 3 jev,luna,haiku` | First N decisions of an arena game from each controller |
| `bun scripts/inspect.ts 3 1 fifo` | Why aircraft were lost in one headless Tower run |
| `bun scripts/smoke.ts jev` | Raw API probes (Jev example, question and option limits, LLM structured output) |

## Fairness notes

- Same seed, same text, same questions and options for every controller. Scenario scripts never
  depend on what a controller does.
- Model versions are pinned (`typesafe/jev-1.13`, not `jev-latest`).
- Latency is wall-clock time around the whole call, retries included, from this machine.
- Cost is OpenRouter's own `usage.cost` for every response. Jev counts more input tokens than an
  LLM for the same request (5.4k vs 4.2k for Luna on a 125-bay "flat" choice), but at $0.042 per
  million it stayed the cheapest per decision in every game ($0.00023 vs $0.0011 Luna and $0.0051
  Haiku on that choice).
- **Rate limits.** New OpenRouter accounts get 20 requests per minute per model (HTTP 429 above).
  LLM calls are spaced to `OPENROUTER_RPM` (default 18); waiting for a slot is not counted as
  latency, but in real time it still limits how often an LLM can decide. Raise `OPENROUTER_RPM`
  in `.env` when your account allows. Jev ran at ~30 per minute without hitting a limit.

## Notes on the Jev API (as of 2026-09-18)

- `POST https://openrouter.ai/api/alpha/decisions` with `model`, `state` (free text) and
  `questions`. Types: `noul` (0–1), `choice` (with `probabilities` and `confidence`), `score`
  (a continuous expected level, with a distribution).
- Hard limit of **255 options** per `choice`. 60 questions in one call worked (~0.5 s); the
  client batches 64 per call.
- The model is not in OpenRouter's default `/models` list (its output modality is "decisions");
  use `?output_modalities=all`.

## Layout

```
src/
  arena/        typed questions, Jev/LLM/bot deciders, generic runner, protocol, bench
  games/        dispatch/, sorting/, highway/ (simulators, text, bots)
  sim/          Tower Control simulator; controllers/, match.ts: its engine
  server.ts     Bun server: pages and one WebSocket per game
web/
  home/         the arena home
  shared/       console CSS and the generic game client
  tower/ dispatch/ sorting/ highway/   one page per game
docs/           notes on Jev in the wild
scripts/        probes, overnight pass, debugging helpers
```
