# How people are testing Jev (as of 2026-09-18)

Jev (TypeSafe AI's first "System One" model) opened in early access on 2026-09-15 and reached
OpenRouter as `typesafe/jev-1.13` on 2026-09-18. This note collects what the community has
tested so far, what held up, and what it means for the games in this repo.

## The short version

- **Speed and price hold up independently.** 0.2–0.7 s per call and ~$0.00002–0.0003 per call
  show up in every third-party test, ours included (0.4 s median from Brazil).
- **Accuracy is "good, not frontier".** Independent tests land slightly below large LLMs on
  judgment quality; the vendor's own workflow evals say "within 3 points".
- **Calibration is still unverified.** No published reliability curve or ECE for Jev yet.
  This is the most-asked open question and a clear gap for an independent paper.
- **Jev is a judgment engine, not a calculator.** The strongest lesson so far: compute every
  exact fact in code and let Jev weigh the facts. From raw state it can be worse than random.
- **The founder agrees it is "basically a zero-shot classifier"** ("exactly right!" on Hacker
  News), trained to be calibrated (RLCD). Architecture is undisclosed.

## Independent tests worth knowing

### Chess and NPC addressee detection — `wondertwins/jev-benchmark`
The most thorough public test. Model `jev-1.13.0`, every raw request published.

- **Chess (outside its lane):** from a FEN string Jev is *worse than random* (533 cp mean loss vs
  403 for random). With code-computed facts ("this bishop will hang") it drops to 144 cp; with
  one-ply tactical facts to 90 cp, roughly **950 Elo**. It solves 24% of mate-in-one puzzles.
- **Phrasing matters as much as computing:** the same facts worded as noise scored 241 cp; worded
  as deltas and plain verdicts, 90 cp.
- **One big `choice` beats a hierarchy:** one choice over all legal moves (144 cp) beat "choose the
  piece, then the square" (217 cp). Picking the piece first locked in 104 cp of loss on average.
- **NPC addressee detection (inside its lane):** F1 0.96 on clean text, 0.93 on messy
  speech-to-text, precision 1.0, 0.17 s median with 8–10 questions per call.
- Their one-line lesson: *"Compute everything that has an exact answer in code, hand the facts to
  Jev, and ask every question you might need in a single call."*

### Every — "Mini-Vibe Check"
37 documents × 21 concurrent questions = 777 judgments in under 0.7 s for about a quarter of a
cent. On writing-defect detection Jev caught 6 of 7 planted problems vs 7 of 7 for Fable 5.1.
Verdict: a good early-warning system; check accuracy before production.

### DevelopersIO (Classmethod) — model routing
40 calls routing conversations into 4 difficulty tiers: 40/40 correct, 0.64–0.67 s median,
~$0.000026 per call, ~3× faster than Gemini 3.5 Flash as a classifier. Confidence was 1.0 except
on the "medium" tier (0.57–0.67), a sign the probabilities do track ambiguity. Small sample.

### Playgrounds and harnesses
- **`hegargarcia/jev-playground`:** tic-tac-toe and Connect Four, Jev vs Luna, Haiku, Gemini 3.5
  Flash-Lite and GPT-6 Astra on shared states. No aggregate results yet ("future work").
- **`thijmenkam/jev-benchmarks`:** support routing, churn score, moderation, field extraction;
  accuracy, Brier, ECE, consistency over repeats, type validity, p50/p95, cost per 1k. Wraps LLMs
  in a "System One-style" adapter so outputs are comparable. Mostly a harness so far.
- **`4esv/jev-eval`:** Jev vs GPT-5.6 Terra on public labeled datasets with calibration. Work in
  progress, no numbers yet.
- **`CompleteDotTech/typesafe-ai-playground`:** 110 use cases, games and dilemmas with A/B views.

### Real-time control demos
Super Mario Bros. from emulator features (`typesafe-mario`), a camera-only MuJoCo drone with Jev
in the loop at 2.5 Hz (`jev-drone`), StarCraft via keyboard and mouse (`tsai-sc`), and a
work-in-progress Minecraft agent fleeing zombies. Mostly demos, few metrics.

### Production-ish uses
Model routers (several `jev-router` projects, LiteLLM-based), agent tool-call gates and
prompt-injection guards (`pi-jev`, `jev-guard`; one report "caught most attacks with almost no
false blocks"), code-review gates, CV screening, email intent routing, and a browser agent
(`browser-use/jev-ultrafast`) where Jev picks each next click and an LLM is called only to type.

### Open replicas
`Mapika/decider` (Qwen3.5-2B fine-tune emitting typed, calibrated decisions), `openjev`, an
RLCD-trained Qwen2.5-1B parallel-constrained-decoding demo, and a report of an MLP on Qwen 4B
reproducing Jev-like behaviour.

## Criticism from the launch thread (Hacker News, ~480 comments)

- "Can't hallucinate" conflates format safety with truth: a confident wrong answer is still wrong.
- The metric that matters is calibration: *"If the value is 0.9 for 1000 answers, ~900 should be
  correct."* Nobody has shown this yet.
- Fuzzy-language traps: "Does the customer want a human agent?" vs "I want your agent to call me
  tomorrow at 5 pm".
- Engineers mapped it to known techniques within hours: encoder classifiers, GLiNER-style span
  models, constrained decoding with logit confidence, conformal prediction, DSPy signatures.
- The most useful reframing: use an LLM to *design* the decision logic, then run the fixed logic
  through Jev in production.

## Our own observations so far (Tower Control)

- Jev never failed a call; small LLMs hit OpenRouter's **20 requests/minute** cap for new accounts.
- Everyone who reads language (Jev, Luna, Haiku) avoided a runway that was closed only in radio
  text and prioritized a minimum-fuel aircraft; the rule-based bot did neither.
- From raw geometry, Jev re-vectored almost every aircraft on every turn ("vector" in 78% of
  answers, median action confidence 0.52) and let 7 of 12 aircraft drift off the scope. This is
  the chess finding again: raw state in, weak judgment out. See the "facts" state mode.
- **Raw vs facts, level 3, seed 42, turn based (one seed, anecdotal):** facts fixed exactly the
  errors they describe and nothing else.

  | | Refused clearances | Left the radar | Landed /12 | Separation losses |
  |---|---|---|---|---|
  | Jev | 11 → 8 | 5 → 1 | 2 → 3 | 8 → 19 |
  | Luna | 52 → 5 | 0 → 0 | 5 → 4 | 4 → 25 |
  | Haiku | 55 → 0 | 10 → 1 | 2 → 6 | 0 → 6 |
  | FIFO bot | 0 | 0 | 8 | 3 |

  With the facts, every model stopped asking for impossible clearances and stopped losing
  aircraft off the scope, then started clearing everyone at once: separation losses went up and
  a 40-line first-come-first-served bot still won. Facts help judgment; they do not supply a plan.

## What this means for our games

| Community finding | How the games use it |
|---|---|
| Facts in code beat raw state | Tower Control gets a **Raw / Facts** state toggle (same questions, richer text) |
| Calibration is the open question | **Dispatch** scores every probability against ground truth (Brier, live reliability chart) |
| Guardrails and injections are a main use case | Dispatch mixes in prank calls and instruction-injection calls |
| One big choice vs a hierarchy is unsettled | **Sorting Hub** runs flat, step-by-step and extract-then-code strategies on the same tree, across the 255-option limit |
| Real-time control is the favourite demo | **Night Highway** puts latency front and centre, with an oracle bot as the ceiling |

## Sources

- TypeSafe — [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Hacker News — [launch thread](https://news.ycombinator.com/item?id=49717558)
- [wondertwins/jev-benchmark](https://github.com/wondertwins/jev-benchmark) (chess, NPC addressee)
- Every — [Mini-Vibe Check](https://every.to/also-true-for-humans/mini-vibe-check-typesafe-s-jev-judged-everything-i-ve-written-in-0-7-seconds)
- DevelopersIO — [Replacing model routing with Jev](https://dev.classmethod.jp/en/articles/jev-for-llm-model-routing/)
- Agentpedia — [Claim-vs-evidence guide](https://agentpedia.codes/blog/jev-system-one-models)
- [hegargarcia/jev-playground](https://github.com/hegargarcia/jev-playground) ·
  [thijmenkam/jev-benchmarks](https://github.com/thijmenkam/jev-benchmarks) ·
  [4esv/jev-eval](https://github.com/4esv/jev-eval) ·
  [CompleteDotTech/typesafe-ai-playground](https://github.com/CompleteDotTech/typesafe-ai-playground)
- Curated lists — [yibie/awesome-jev](https://github.com/yibie/awesome-jev) ·
  [AnotiaWang/awesome-jev](https://github.com/AnotiaWang/awesome-jev)
- Coverage — [Latent Space AINews](https://www.latent.space/p/ainews-jev-a-system-one-model-that) ·
  [The Register](https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711) ·
  [Developers Digest](https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026)
