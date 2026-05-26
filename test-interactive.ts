/**
 * omp-supervisor — Interactive test suite
 *
 * Tests the extension through the full OMP pipeline:
 * MockModel → Agent → AgentSession → tool execution → results
 *
 * IMPORTANT: Each test creates its own createMockPi() instance because
 * the SupervisorStateManager is stateful — calling start_supervision
 * in one test would block the next test's call.
 */
import { createMockPi, createMockSession, runSession, TestSuite } from "omp-test-harness";
import extFactory from "./src/index";

const suite = new TestSuite("omp-supervisor (Interactive)");

// ─── Tool invocation through AgentSession ───

await suite.test("start_supervision tool callable via session", async () => {
  const { toolList } = createMockPi(extFactory);
  const { session, dispose } = createMockSession(
    [
      {
        content: [
          {
            type: "toolCall",
            name: "start_supervision",
            arguments: { outcome: "Write a hello world function", sensitivity: "low" },
          },
        ],
      },
      { content: ["Supervision started."], stopReason: "stop" },
    ],
    toolList
  );

  const { toolResults, completed } = await runSession(session, "Start supervising my work.");
  dispose();

  const result = toolResults.get("start_supervision");
  return (
    completed &&
    result !== undefined &&
    result.content?.[0]?.text?.includes("Supervision active")
  );
});

await suite.test("start_supervision returns structured result", async () => {
  const { toolList } = createMockPi(extFactory);
  const { session, dispose } = createMockSession(
    [
      {
        content: [
          {
            type: "toolCall",
            name: "start_supervision",
            arguments: {
              outcome: "Refactor auth module to use DI",
              sensitivity: "high",
              model: "anthropic/claude-haiku-4-5-20251001",
            },
          },
        ],
      },
      { content: ["Done."], stopReason: "stop" },
    ],
    toolList
  );

  const { toolResults, completed } = await runSession(session, "Help me refactor.");
  dispose();

  const result = toolResults.get("start_supervision");
  const text = result?.content?.[0]?.text ?? "";
  return (
    completed &&
    text.includes("Supervision active") &&
    text.includes("Refactor auth module to use DI") &&
    text.includes("high")
  );
});

await suite.test("start_supervision blocks when already active", async () => {
  const { toolList } = createMockPi(extFactory);

  // First call — activate supervision
  const { session: s1, dispose: d1 } = createMockSession(
    [
      {
        content: [{
          type: "toolCall",
          name: "start_supervision",
          arguments: { outcome: "First goal" },
        }],
      },
      { content: ["Started."], stopReason: "stop" },
    ],
    toolList
  );
  const r1 = await runSession(s1, "Start supervision.");
  d1();
  const firstResult = r1.toolResults.get("start_supervision")?.content?.[0]?.text ?? "";
  const firstActive = firstResult.includes("Supervision active");

  // Second call in the same mockPi state — should be blocked
  const { session: s2, dispose: d2 } = createMockSession(
    [
      {
        content: [{
          type: "toolCall",
          name: "start_supervision",
          arguments: { outcome: "Another goal" },
        }],
      },
      { content: ["Blocked."], stopReason: "stop" },
    ],
    toolList
  );
  const r2 = await runSession(s2, "Try again.");
  d2();
  const secondResult = r2.toolResults.get("start_supervision")?.content?.[0]?.text ?? "";
  const secondBlocked = secondResult.includes("already active");

  return firstActive && secondBlocked;
});

await suite.test("/supervise command registered with handler", async () => {
  const { commands } = createMockPi(extFactory);
  return commands.has("supervise") && typeof commands.get("supervise")?.handler === "function";
});

await suite.test("/supervise command has description", async () => {
  const { commands } = createMockPi(extFactory);
  const cmd = commands.get("supervise");
  return typeof cmd?.description === "string" && cmd.description.length > 0;
});

if (!suite.report()) process.exit(1);
