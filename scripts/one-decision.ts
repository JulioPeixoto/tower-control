// Asks each controller for a single decision on the same picture. Cheap end-to-end check.
//   bun scripts/one-decision.ts [level] [seed] [simSeconds] [controllers]
import { makeController } from "../src/controllers/index";
import { describeState } from "../src/sim/describe";
import { buildQuestions } from "../src/sim/questions";
import { generateScenario } from "../src/sim/scenario";
import { World } from "../src/sim/world";

const [level = "3", seed = "42", at = "240", list = "jev,luna,haiku,fifo"] = Bun.argv.slice(2);
const world = new World(generateScenario(Number(level), Number(seed)));
while (world.t < Number(at)) world.step(0.5);

const stateText = describeState(world);
const questions = buildQuestions(world);
console.log(stateText);
console.log(`\n${questions.length} questions for ${questions.length / 4} aircraft\n`);

await Promise.all(
  list.split(",").map(async (id) => {
    const c = makeController(id, Number(seed));
    try {
      const d = await c.decide({ t: world.t, stateText, questions, view: world.view() });
      const cmds = d.commands
        .filter((x) => x.action !== "continue")
        .map((x) => `${x.id}:${x.action}${x.heading !== undefined ? ` hdg ${x.heading}` : ""}${x.altitude ? ` ${x.altitude}ft` : ""}${x.speed ? ` ${x.speed}kt` : ""}`);
      console.log(
        `${c.label.padEnd(18)} ${String(Math.round(d.latencyMs)).padStart(5)} ms  $${d.costUsd.toFixed(6)}  in ${d.inputTokens} out ${d.outputTokens}` +
          `  invalid ${d.invalid ?? 0}${d.error ? `  ERROR ${d.error}` : ""}\n    ${cmds.join(" | ") || "(all continue)"}`,
      );
    } catch (e) {
      console.log(`${c.label.padEnd(18)} FAILED ${e instanceof Error ? e.message : e}`);
    }
  }),
);
