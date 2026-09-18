# Tower Control

An air traffic control game where AI models are the controllers. Every controller gets its
own radar scope with **the same traffic from the same seed**, side by side: TypeSafe's
**Jev** (a "System One" decision model) against small LLMs (**GPT-5.6 Luna**, **Claude
Haiku 4.5**, **Gemini 3.5 Flash-Lite**) and two rule-based baselines.

It is a visual companion to the `jev-decision-bench` research plan. It is also a benchmark
in its own right: every run is saved with each decision's latency, cost and answers.

## Why air traffic control

- **Many decisions at once.** Every aircraft that is not on final needs an answer on every turn.
- **Hierarchical choices.** Flattened, one aircraft's instruction has 276 possible values
  (continue, 2 landing clearances, 21 holds, 252 vectors), just over Jev's limit of 255 options per
  question. So the decision is split into 4 typed questions per aircraft.
- **Long horizon.** Clearing the closest aircraft first looks right now and runs someone else out of fuel later.
- **Language matters.** Runway closures and emergencies (mayday, minimum fuel, medical) reach the
  controller **only as radio text**. The rule-based bots cannot read it; the models can.
- **Latency matters (in real time).** The world keeps moving while a model thinks.

## Two clocks

| Mode | What happens while a controller thinks | What it measures |
|---|---|---|
| **Turn based** | The traffic waits for every controller | Decision quality only |
| **Real time** | The traffic keeps moving; the answer is applied to a newer picture than the one it was based on | Quality under latency |

The gap between the two modes shows how much of a controller's result comes from being smart
and how much from being fast. In real time, each aircraft on the scope shows a **ghost**: where
the controller last saw it. A short tether means a fresh picture; a long one means the model is
deciding about the past.

## Quick start

```sh
bun install
cp .env.example .env        # then set OPENROUTER_API_KEY
bun run dev                 # http://localhost:3000
```

Pick the traffic level, seed, clock and controllers, then press **Start match**. The bots work
without an API key. A match stops by itself when the last browser tab closes.

The page also takes URL parameters, useful for recordings:
`/?autostart=1&level=4&seed=7&mode=realtime&speed=8&controllers=jev,luna,haiku`

## Headless benchmark

```sh
bun run bench --level 3 --seeds 1-5 --mode turn --controllers jev,luna,haiku,fifo
```

Each run is written to `runs/<timestamp>-L<level>-s<seed>-<mode>.json` with the config, final
metrics and every decision (sim time asked/applied, latency, tokens, cost, commands, and for Jev
the confidence of each answer plus the full distribution of each action). `runs/` is git-ignored;
copy the runs you want to keep into a tracked folder.

Controllers: `jev`, `luna`, `haiku`, `flash-lite`, `fifo`, `random`, or any OpenRouter model as
`llm:<model-id>` / `jev:<model-id>`.

Other scripts:

| Command | What it does |
|---|---|
| `bun scripts/one-decision.ts 3 42 300` | One decision from each controller on the same picture; prints the state text too |
| `bun scripts/inspect.ts 3 1 fifo` | Why aircraft were lost in one headless run |
| `bun scripts/smoke.ts jev` | Raw API probes (Jev example, question and option limits, LLM structured output) |

## Traffic levels

| Level | Arrivals | Maydays | Min. fuel | Medical | Runway closures |
|---|---|---|---|---|---|
| 1 · Quiet morning | 5 in 6 min | – | – | – | – |
| 2 · Steady flow | 9 in 9 min | – | 1 | – | – |
| 3 · Wind shear | 12 in 10 min | 1 | 1 | – | 1 |
| 4 · Rush hour | 16 in 11 min | 1 | 1 | 1 | 1 |
| 5 · Everything at once | 22 in 12 min | 2 | 2 | 1 | 2 |

## Rules (what every controller is told)

- Parallel runways 09L and 09R, both landing eastbound. A landing clearance sends the aircraft
  direct to its final approach fix (8 nm west, 3000 ft), then it lands by itself.
- Go-around if it reaches the fix above 3500 ft, the runway is closed, or the same runway had a
  landing less than 50 s earlier. Clearances are refused beyond 25 nm.
- Separation: 3 nm or 1000 ft (2.5 nm on the same final; parallel finals are exempt).
- Lost: leaving the 34 nm scope, running out of fuel, a mayday not landed within 6 minutes, collisions.

**Score** = 100 × landed − 1000 × crashed − 300 × left the scope − 50 × separation losses
− 25 × go-arounds − 150 × late medical landings − 5 × minutes of excess delay.

## Fairness

- Every controller reads **the same state text** and answers **the same four questions per
  aircraft**, with identical options and wording (`src/sim/questions.ts`). Jev gets them as typed
  `choice` questions; LLMs get them as a strict JSON schema.
- Model versions are pinned (`typesafe/jev-1.13`, not `jev-latest`). LLMs run with reasoning
  effort `none` by default.
- Latency is wall-clock time around the whole call, retries included, from this machine.
- Cost comes from OpenRouter's own `usage.cost` on every response.
- The scenario script never depends on controller actions, so all scopes face the same events.

## Notes on the Jev API (as of 2026-09-18)

- Endpoint: `POST https://openrouter.ai/api/alpha/decisions` with `model`, `state` (free text) and
  `questions`. Question types: `noul` (probability 0–1), `choice` (with `probabilities` and
  `confidence`) and `score` (ordinal, with a distribution).
- Hard limit of **255 options** per `choice` (`"Too many choices. Must have at most 255 choices."`).
- 60 questions in one call worked (~0.5 s). The client batches 64 per call.
- Jev reports more input tokens than an LLM for the same state (it appears to count the state per
  question), but is still the cheapest per decision: about $0.0002 vs $0.0007 (Luna) and
  $0.0044 (Haiku) on a 6-aircraft picture.

## Layout

```
src/
  sim/          deterministic simulator: scenario, world physics, state text, questions
  controllers/  jev.ts, llm.ts (OpenRouter), bots.ts (FIFO, random)
  match.ts      lockstep runner for both clocks, run logs
  server.ts     Bun server + WebSocket for the browser
  bench.ts      headless runs
web/            radar scope UI (canvas), paper flight strips, radio log
scripts/        API probes and debugging helpers
```
