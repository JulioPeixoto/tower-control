# First results (2026-09-18, overnight pass)

A first, small pass over the four games with real models. **Few seeds: treat every number as a
pilot, not a finding.** All runs are turn based (the world waits for each answer), so these
compare decision quality; latency is reported but does not affect the score. Models: Jev 1.13,
GPT-5.6 Luna and Claude Haiku 4.5 (reasoning effort `none`), through OpenRouter from Brazil.

Reproduce with `bash scripts/overnight.sh`, then `bun scripts/summarize.ts`.

## City Dispatch · level 4 "Storm" · 3 seeds · 78 calls per model

| | Correct | Missed | Fooled by prank / injection | Brier (send a unit) | p50 latency | Cost, 78 calls |
|---|---|---|---|---|---|---|
| Jev 1.13 | 74/78 | 4 | 0 / 0 | 0.019 | 0.39 s | $0.0020 |
| GPT-5.6 Luna | 73/78 | 4 | 0 / 0 | 0.049 | 1.21 s | $0.0086 |
| Claude Haiku 4.5 | 76/78 | 2 | 0 / 0 | 0.017 | 1.37 s | $0.0575 |
| Keyword bot | 43/78 | 10 | 8 / 4 | 0.266 | – | – |
| Oracle | 78/78 | 0 | 0 / 0 | 0.000 | – | – |

- No model was fooled by a single prank or instruction-injection call; the keyword bot was fooled 12 times.
- Almost every model "miss" was one call, "a car blocking the fire lane for two hours", which I
  had labelled as needing a unit. The question's own criteria call that a non-emergency report,
  and all three models declined it, so **the label was wrong, not the models**. It is now
  relabelled (commit `599d0f3`) and these runs are archived under `runs/dispatch/old-labels/`.
- On that ambiguous call Jev hedged (p = 0.38–0.47) while Luna was confident (p = 0.02): a small,
  concrete calibration example.
- Haiku cost ~29× Jev per call here, Luna ~4×; Jev answered 3–3.5× faster than either.

**Rerun with the corrected labels (same 3 seeds):**

| | Correct | Brier | p50 latency | Cost, 78 calls |
|---|---|---|---|---|
| Jev 1.13 | 78/78 | 0.004 | 0.40 s | $0.0020 |
| GPT-5.6 Luna | 78/78 | 0.000 | 1.27 s | $0.0086 |
| Claude Haiku 4.5 | 78/78 | 0.003 | 1.34 s | $0.0575 |
| Keyword bot | 45/78 | 0.318 | – | – |

- All three models are perfect at level 4: **this level saturates**. Pranks, injections and calm
  emergencies no longer separate small models; only the keyword bot falls for them.
- With every answer right, Brier only rewards confidence: Luna answers 0 or 1, Jev hedges a
  little. **Measuring calibration needs genuinely ambiguous calls** with a known base rate — the
  obvious next level ("grey zone") for the paper's RQ2.

## Sorting Hub · level 3 "National hub" (125 bays)

Score is 10 per correct bay, −15 per wrong one, so 240 is perfect for 24 parcels.

| Strategy | Jev 1.13 | GPT-5.6 Luna | Claude Haiku 4.5 | Regex parser |
|---|---|---|---|---|
| Extract, seed 1 | **240** (24/24) | 195 | 215 | 15 |
| Extract, seed 2 | **240** (24/24) | 145 | 145 | 65 |
| Step by step, seed 1 | **240** (24/24) | 190 | 215 | 90 |
| Flat, seed 1 | **165** (21/24) | −110 (10/24) | −110 (10/24) | 90 |

Level 4 (343 bays), flat, seed 1: **Jev 0/24** (every call refused: "Too many choices. Must have
at most 255 choices"), Luna 18/24, regex parser 13/24.

- **Every LLM weight error was a label in pounds.** With reasoning off, Luna and Haiku read
  "3.1 lb" as if it were 3.1 kg and chose the wrong weight bin, both making the same mistakes on
  the same parcels. Jev converted every one correctly. (Next: the same run with reasoning `low`.)
- Choosing among all 125 bays at once is where the LLMs collapse (10/24); Jev dropped far less
  (21/24). Extract and step-by-step are near perfect for everyone who converts units.
- Cost per decision on the 125-bay flat choice: Jev $0.00023, Luna $0.0011, Haiku $0.0051. Jev
  counts more input tokens (5.4k vs 4.2k) but its price per token is ~5× lower than Luna's.
- A few LLM calls hit HTTP 429 despite the limiter; the default is now 18 per minute.

## Night Highway · level 3 "Night shift" · seed 1 · turn based

141 decisions per model; score is 10 per coin, −100 per crash.

| | Raw: crashes | Raw: score | Facts: crashes | Facts: score | Cost (raw + facts) |
|---|---|---|---|---|---|
| Jev 1.13 | 5 | −370 | **0** | **+80** | $0.006 |
| GPT-5.6 Luna | 9 | −830 | 2 | −120 | $0.021 |
| Claude Haiku 4.5 | 2 | −150 | 2 | −140 | $0.140 |
| Autopilot (plans on the true road) | 0 | +70 | 0 | +70 | – |

- The chess finding replicates: **given seconds-to-barrier per lane, Jev went from 5 crashes to
  0 and edged past the planning autopilot on coins.** Luna improved a lot; Haiku, already the best
  reader of the raw text, barely changed.
- From the raw text (distances in metres, speed in m/s) Haiku was the strongest model.

**Same road in real time at 1× (the road never waits):**

| Crashes | Turn, raw | Real time, raw | Turn, facts | Real time, facts | Decisions in real time |
|---|---|---|---|---|---|
| Jev 1.13 | 5 | 3 | 0 | 2 | 84–85 |
| GPT-5.6 Luna | 9 | 10 | 2 | 12 | 23 |
| Claude Haiku 4.5 | 2 | 11 | 2 | 13 | 23 |
| Autopilot | 0 | 0 | 0 | 0 | 143 |

- When the road does not wait, the LLMs fall apart (Haiku: 2 → 11–13 crashes) and Jev holds.
- **Caveat that matters:** in real time the LLMs made only 23 decisions in ~75 s partly because
  this account is capped at 18 requests per minute per model, not only because each answer took
  ~1.3 s. Without the cap they could have made ~55. Separating latency from the rate cap needs a
  run with a higher `OPENROUTER_RPM` on an account that allows it.

## What to run next

1. More seeds everywhere (5–10) before quoting any number.
2. Sorting Hub with LLM reasoning `low`: does the pounds-to-kilograms error disappear, and at what cost and latency?
3. A City Dispatch "grey zone" level with ambiguous calls and a known base rate, to measure calibration (RQ2).
4. Night Highway real time on an uncapped account, to separate latency from the rate limit.
5. Tower Control: facts plus a sequencing hint (next free landing slot per runway), to test whether the missing piece is information or planning.

## Tower Control · level 3 "Wind shear" · seed 42

See `docs/jev-in-the-wild.md` ("Our own observations"): the raw-vs-facts comparison. Facts
removed the errors they describe (impossible clearances, aircraft lost off the radar) but no
model learned to sequence arrivals, and the FIFO bot still won.
