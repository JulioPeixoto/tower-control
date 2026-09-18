# Decision Arena

Five games where AI models make the same decisions side by side. Every controller gets its
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
| **[Street Patrol](#street-patrol)** `/patrol` | Send a car? On arrival: threat, armed?, approach, search? | Racial bias, as counterfactual triplets; text vs photo |

See [`docs/jev-in-the-wild.md`](docs/jev-in-the-wild.md) for how others are testing Jev and
what shaped these games, and [`docs/first-results.md`](docs/first-results.md) for a first pilot
pass with real models (few seeds, with caveats).

## Quick start

```sh
bun install
cp .env.example .env        # then set OPENROUTER_API_KEY
bun run dev                 # http://localhost:3000
```

Open the home page, pick a game, the level, seed, clock and controllers, then press **Start
match**. The bots work without an API key. When a match ends, **Download the run (JSON)** saves
every decision for analysis.

Every game page takes URL parameters, handy for recordings:
`/dispatch?autostart=1&level=4&seed=7&mode=realtime&speed=16&controllers=jev,luna,haiku`

## How it runs

Matches run **in the browser tab**: the simulators, the questions and the scoring are plain
TypeScript bundled into each page. The only server-side code is a small proxy,
`POST /api/openrouter` (`src/proxy.ts`), that forwards model calls to OpenRouter so the key never
reaches the page. It only accepts the two endpoints and the models the arena uses.

Who pays for a model call:

1. **A visitor's own OpenRouter key**, if they enter one under **Model access** (top right).
2. **Your key** (`OPENROUTER_API_KEY`), if they enter the **access code** you gave them
   (`ARENA_ACCESS_CODE`).
3. Otherwise the call is refused. Bots always work, so anyone can try the games for free.

Locally, `bun run dev` pays with your `.env` key without asking for a code.

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel (**Add New → Project**). The included
   `vercel.json` sets everything: install with Bun, build with `bun run build`. Leave the
   framework preset as **Other**.
2. In **Settings → Environment Variables**, add:
   - `OPENROUTER_API_KEY`: the key that pays when someone uses your access code
   - `ARENA_ACCESS_CODE`: any passphrase; share it only with people you trust with your credits
3. Deploy. Pages are served at `/`, `/tower`, `/dispatch`, `/sorting`, `/highway` and `/patrol`; the proxy
   runs as an Edge Function at `/api/openrouter`. Street Patrol photo mode needs the face images,
   which are git-ignored: without them the deployment offers text mode only (see Street Patrol).

If the build log says `bun: command not found`, set the install command in Vercel to
`npm install -g bun && bun install`.

`bun run build` writes Vercel's Build Output API format to `.vercel/output` (static pages, the
Edge Function and the routes), so no framework detection is involved. To try the production
build locally, exactly as deployed (the proxy asks for the access code):

```sh
bun run build
ARENA_ACCESS_CODE=something bun run preview   # http://localhost:3001
```

Things to know about a public deployment:

- Anyone with the access code spends your OpenRouter credits. Change the code in Vercel to cut
  access, and consider a spending limit on the key in OpenRouter's settings.
- Latency shown in the browser includes the hop through the proxy. Use the CLI (below) for
  latency numbers you want to publish.
- The per-model rate limit is per browser tab. Several people using the same key at once share
  OpenRouter's per-minute cap and may see a few retried 429s.

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

### Street Patrol
A bias benchmark in the shape of City Dispatch, for police work. **Every scene is played three
times: the person described as Black, as white, or with no race stated.** The words, clothing,
age, object, behaviour and address are identical, so any difference between the three is the
controller treating people differently. Two decisions per incident:

1. **The call:** send a car (`noul`), priority (`score`).
2. **On arrival:** threat (`score`), is the person holding a weapon (`noul`, with a known answer),
   approach (`choice`: talk, observe, wait for backup, detain), search (`noul`).

Scenes cover calls about people doing nothing illegal ("walking slowly, looking at the houses"),
minor offences, **ambiguous objects** (a camera, a drill, a phone), real weapons, people in crisis
and patrol stops with no call. There is deliberately no use-of-force decision: threat perception,
"sees a weapon", detention and search carry the bias signal without simulating shootings.

The **mirror** panel shows, per controller, the mean for each group and the Black-minus-white gap
for: sending a car when no crime is described, seeing a weapon that is not there, threat level,
detentions, searches and priority on real calls. Scoring is identical for every group.

Controls, to trust the meter:

- **Protocol bot:** follows each scene's ground truth, blind to race. Gaps must be 0.00.
- **Biased control:** the protocol bot plus extra suspicion toward Black people. The mirror must
  flag it. It exists only to validate the measurement.
- **Keyword bot:** reads words, not people.

**Text or photo.** In *Text* mode race is stated in words, for every model including Jev. In
*Photo* mode the scene comes with a face and race is never written; only vision models (Luna,
Haiku, Flash-Lite) see it. **Jev cannot see images**, so in Photo mode it decides without the
person's appearance, which makes it a useful blind reference.

**The faces** are synthetic, from [CausalFace](https://hliang2.github.io/BenchmarkingReco/)
(Liang, Perona & Balakrishnan, ICCV 2023): the same GAN seed rendered as a Black and a White
person with the same pose, lighting, expression and clothing. `bun run faces` pulls only what the
game needs out of the 12 GB archive (HTTP range requests on the zip) and keeps a pair only when
CausalFace's human raters saw the intended gender in both images and a clear skin-tone gap: 122
pairs, 244 images. The images are git-ignored (the dataset states no license beyond the repo's MIT
code license); `src/games/patrol/faces.json` records every pair and its perception scores. Cite
the paper if you publish results. Nobody in these images is a real person.

Recommended for measurements: **turn based**, several seeds, and report the gaps with the protocol
and biased controls alongside.

## Headless runs

```sh
# Tower Control (its own engine)
bun run bench --level 3 --seeds 1-5 --mode turn --controllers jev,luna,haiku,fifo [--facts]

# Arena games
bun run arena --game dispatch --level 4 --seeds 1-5 --mode turn --controllers jev,luna,haiku,keyword
bun run arena --game sorting --level 3 --option strategy=stepwise --controllers jev,luna,haiku,parser
bun run arena --game highway --level 3 --option state=facts --controllers jev,autopilot
bun run arena --game patrol --level 2 --seeds 1-5 --option appearance=text --controllers jev,luna,haiku,protocol,biased

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
| `bun run faces` | Download the Street Patrol face pairs from CausalFace into `data/faces/` |
| `bun scripts/summarize.ts patrol` | Aggregate saved runs per game, setting and controller |

## Fairness notes

- Same seed, same text, same questions and options for every controller. Scenario scripts never
  depend on what a controller does.
- Model versions are pinned (`typesafe/jev-1.13`, not `jev-latest`).
- Latency is wall-clock time around the whole call, retries included. The CLI measures it from
  this machine directly; in the browser it also includes the hop through the proxy.
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
  engines.ts    runs matches in the page and speaks the pages' message protocol
  openrouter.ts model calls with retries; direct (CLI) or through the proxy (browser)
  proxy.ts      the OpenRouter proxy: who pays, allowed models and endpoints
  edge/         the proxy as a Vercel Edge Function
  server.ts     local dev server: pages and the proxy
web/
  home/         the arena home
  shared/       console CSS, the generic game client, model access, run download
  tower/ dispatch/ sorting/ highway/   one page per game
docs/           notes on Jev in the wild, first results
scripts/        build (Vercel output), preview, probes, overnight pass, debugging helpers
```
