// Probe the OpenRouter decisions API (Jev) and chat completions (small LLMs).
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error("OPENROUTER_API_KEY missing");

const headers = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "X-OpenRouter-Title": "tower-control",
};

async function post(url: string, body: unknown) {
  const t0 = performance.now();
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();
  return { status: res.status, ms, text };
}

const which = process.argv[2] ?? "all";

if (which === "all" || which === "jev") {
  console.log("=== Jev: example from docs ===");
  const r = await post("https://openrouter.ai/api/alpha/decisions", {
    model: "typesafe/jev-1.13",
    state: "Help! My payouts have been failing for 3 days.",
    questions: {
      is_urgent: {
        type: "noul",
        instructions: "Does this message convey urgency?",
        criteria: { true: "Explicitly time-sensitive", false: "No urgency expressed" },
      },
      department: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: {
          billing: "Payments, invoicing, refunds",
          technical: "Bugs, outages, integrations",
          sales: "Pricing, upgrades, new accounts",
        },
      },
      frustration: {
        type: "score",
        instructions: "How frustrated is the customer?",
        criteria: ["Calm", "Frustrated", "Very angry"],
      },
    },
  });
  console.log(r.status, `${r.ms}ms`);
  console.log(r.text);
}

if (which === "all" || which === "jev-many") {
  // How many questions per call? 15 planes x 4 questions = 60.
  const n = Number(process.argv[3] ?? 60);
  const questions: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    questions[`q${i}`] = {
      type: "choice",
      instructions: `Which heading should aircraft ${i} fly?`,
      criteria: { N: "north", E: "east", S: "south", W: "west" },
    };
  }
  console.log(`=== Jev: ${n} questions ===`);
  const r = await post("https://openrouter.ai/api/alpha/decisions", {
    model: "typesafe/jev-1.13",
    state: "Several aircraft are approaching the airport from the west.",
    questions,
  });
  console.log(r.status, `${r.ms}ms`);
  console.log(r.text.slice(0, 1500));
}

if (which === "all" || which === "jev-wide") {
  // Cardinality limit: choice with n options.
  const n = Number(process.argv[3] ?? 256);
  const criteria: Record<string, string> = {};
  for (let i = 0; i < n; i++) criteria[`opt${i}`] = `Option number ${i}`;
  console.log(`=== Jev: choice with ${n} options ===`);
  const r = await post("https://openrouter.ai/api/alpha/decisions", {
    model: "typesafe/jev-1.13",
    state: "Pick option number 42.",
    questions: { pick: { type: "choice", instructions: "Which option was requested?", criteria } },
  });
  console.log(r.status, `${r.ms}ms`);
  console.log(r.text.slice(0, 600));
}

if (which === "all" || which === "llm") {
  for (const model of ["openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"]) {
    console.log(`=== ${model}: structured output ===`);
    const r = await post("https://openrouter.ai/api/v1/chat/completions", {
      model,
      messages: [{ role: "user", content: "Help! My payouts have been failing for 3 days. Classify this ticket." }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "decision",
          strict: true,
          schema: {
            type: "object",
            properties: {
              department: { type: "string", enum: ["billing", "technical", "sales"] },
              is_urgent: { type: "boolean" },
            },
            required: ["department", "is_urgent"],
            additionalProperties: false,
          },
        },
      },
      reasoning: { effort: process.argv[3] ?? "low" },
      usage: { include: true },
    });
    console.log(r.status, `${r.ms}ms`);
    console.log(r.text.slice(0, 1500));
  }
}
