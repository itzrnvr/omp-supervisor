/**
 * omp-supervisor — Non-interactive test suite
 *
 * Tests the extension's tool and command registration,
 * pure-logic modules (analysis-guard, steering-run, snapshot),
 * and the start_supervision tool execute path with a mock context.
 */
import { createMockPi, TestSuite } from "omp-test-harness";
import extFactory from "./src/index";
import { createAnalysisToken, getCurrentAnalysisState } from "./src/analysis-guard";
import { AgentRunSteeringTracker } from "./src/steering-run";
import { buildSnapshotFromBranch } from "./src/snapshot";
import type { SupervisorState, Sensitivity } from "./src/types";

const { tools, commands } = createMockPi(extFactory);
const suite = new TestSuite("omp-supervisor (Non-Interactive)");

// ─── Extension registration ───

await suite.test("registers start_supervision tool", async () => {
  return tools.has("start_supervision");
});

await suite.test("registers /supervise command", async () => {
  return commands.has("supervise");
});

await suite.test("start_supervision tool has correct label", async () => {
  const tool = tools.get("start_supervision");
  return tool?.label === "Start Supervision";
});

await suite.test("start_supervision tool has parameters schema", async () => {
  const tool = tools.get("start_supervision");
  return tool?.parameters?._def !== undefined || tool?.parameters !== undefined;
});

// ─── Analysis guard (pure logic) ───

function makeState(overrides: Partial<SupervisorState> = {}): SupervisorState {
  return {
    active: true,
    outcome: "ship the fix",
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    sensitivity: "medium" as Sensitivity,
    interventions: [],
    startedAt: 123,
    turnCount: 1,
    ...overrides,
  };
}

await suite.test("analysis token captures current state", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  return token.turnCount === 1 && token.provider === "anthropic" && token.modelId === "claude-haiku-4-5-20251001";
});

await suite.test("analysis token is immutable when state mutates", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  live.turnCount = 2;
  return token.turnCount === 1;
});

await suite.test("getCurrentAnalysisState accepts matching state", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  return getCurrentAnalysisState(live, token) === live;
});

await suite.test("getCurrentAnalysisState rejects null", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  return getCurrentAnalysisState(null, token) === null;
});

await suite.test("getCurrentAnalysisState rejects inactive state", async () => {
  const live = makeState({ active: false });
  const token = createAnalysisToken(makeState());
  return getCurrentAnalysisState(live, token) === null;
});

await suite.test("getCurrentAnalysisState rejects changed startedAt", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  live.startedAt = 456;
  return getCurrentAnalysisState(live, token) === null;
});

await suite.test("getCurrentAnalysisState rejects changed turnCount", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  live.turnCount = 2;
  return getCurrentAnalysisState(live, token) === null;
});

await suite.test("getCurrentAnalysisState rejects changed sensitivity", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  live.sensitivity = "high";
  return getCurrentAnalysisState(live, token) === null;
});

await suite.test("getCurrentAnalysisState rejects changed provider", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  live.provider = "openai";
  return getCurrentAnalysisState(live, token) === null;
});

await suite.test("getCurrentAnalysisState rejects changed modelId", async () => {
  const live = makeState();
  const token = createAnalysisToken(live);
  live.modelId = "gpt-5";
  return getCurrentAnalysisState(live, token) === null;
});

// ─── Steering run tracker (pure logic) ───

await suite.test("steering tracker: fresh state has no steers", async () => {
  const tracker = new AgentRunSteeringTracker();
  return !tracker.hasSteered();
});

await suite.test("steering tracker: can mark a run as steered", async () => {
  const tracker = new AgentRunSteeringTracker();
  const runId = tracker.startRun();
  return tracker.tryMarkSteered(runId) && tracker.hasSteered(runId);
});

await suite.test("steering tracker: double-steer same run rejected", async () => {
  const tracker = new AgentRunSteeringTracker();
  const runId = tracker.startRun();
  tracker.tryMarkSteered(runId);
  return !tracker.tryMarkSteered(runId);
});

await suite.test("steering tracker: new run allows fresh steer", async () => {
  const tracker = new AgentRunSteeringTracker();
  const first = tracker.startRun();
  tracker.tryMarkSteered(first);
  const second = tracker.startRun();
  return !tracker.hasSteered(second) && tracker.tryMarkSteered(second);
});

await suite.test("steering tracker: stale runId rejected", async () => {
  const tracker = new AgentRunSteeringTracker();
  const first = tracker.startRun();
  tracker.startRun();
  return !tracker.tryMarkSteered(first);
});

// ─── Snapshot builder (pure logic) ───

await suite.test("snapshot includes tool calls and tool results", async () => {
  const snapshot = buildSnapshotFromBranch([
    {
      type: "message",
      message: { role: "user", content: "Check the PR state." },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_shell",
            name: "bash",
            arguments: { command: "git status" },
          },
        ],
        stopReason: "toolUse",
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call_shell",
        toolName: "bash",
        content: [{ type: "text", text: "## main...origin/main" }],
        isError: false,
      },
    },
  ], 10);

  const transcript = snapshot.map((m) => `${m.role}: ${m.content}`).join("\n");
  return (
    snapshot.length === 3 &&
    transcript.includes("TOOL CALL: bash id=call_shell") &&
    transcript.includes("TOOL RESULT: bash OK id=call_shell") &&
    transcript.includes("## main...origin/main")
  );
});

await suite.test("snapshot includes assistant errors", async () => {
  const snapshot = buildSnapshotFromBranch([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "No tool call found for function call output.",
      },
    },
  ], 10);

  return (
    snapshot.length === 1 &&
    snapshot[0].content.includes("ASSISTANT ERROR")
  );
});

await suite.test("snapshot includes user bash output", async () => {
  const snapshot = buildSnapshotFromBranch([
    {
      type: "message",
      message: {
        role: "bashExecution",
        command: "pwd",
        output: "/tmp/project",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      },
    },
  ], 10);

  return (
    snapshot.length === 1 &&
    snapshot[0].role === "tool" &&
    snapshot[0].content.includes("USER BASH: pwd") &&
    snapshot[0].content.includes("/tmp/project")
  );
});

await suite.test("snapshot respects limit", async () => {
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push({ type: "message", message: { role: "user", content: `msg ${i}` } });
  }
  const snapshot = buildSnapshotFromBranch(entries, 3);
  return snapshot.length === 3 && snapshot[0].content === "msg 7";
});

await suite.test("snapshot includes failed tool results", async () => {
  const snapshot = buildSnapshotFromBranch([
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call_bad",
        toolName: "bash",
        content: [{ type: "text", text: "Command failed" }],
        details: { exitCode: 1 },
        isError: true,
      },
    },
  ], 10);

  return (
    snapshot[0].role === "tool" &&
    snapshot[0].content.includes("TOOL RESULT: bash ERROR") &&
    snapshot[0].content.includes("Command failed")
  );
});

await suite.test("snapshot skips excluded bash executions", async () => {
  const snapshot = buildSnapshotFromBranch([
    {
      type: "message",
      message: {
        role: "bashExecution",
        command: "secret command",
        output: "hidden",
        excludeFromContext: true,
      },
    },
  ], 10);

  return snapshot.length === 0;
});

await suite.test("snapshot includes assistant aborts", async () => {
  const snapshot = buildSnapshotFromBranch([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        stopReason: "aborted",
        errorMessage: "Operation aborted",
      },
    },
  ], 10);

  return (
    snapshot[0].role === "assistant" &&
    snapshot[0].content.includes("partial") &&
    snapshot[0].content.includes("ASSISTANT ABORTED")
  );
});

// ─── start_supervision tool (mock context) ───

await suite.test("start_supervision tool: blocks when already active", async () => {
  const tool = tools.get("start_supervision")!;
  // First call starts supervision
  await tool.execute(
    "id1",
    { outcome: "Test goal", sensitivity: "medium" },
    { aborted: false },
    () => {},
    {
      cwd: process.cwd(),
      model: { provider: "anthropic", id: "claude-haiku-4-5-20251001" },
      modelRegistry: {
        find: () => null,
        getApiKeyForProvider: () => "test-key",
      },
      sessionManager: { getBranch: () => [] },
      ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, custom: async () => null },
    }
  );

  // Second call should be blocked
  const result = await tool.execute(
    "id2",
    { outcome: "Another goal" },
    { aborted: false },
    () => {},
    {
      cwd: process.cwd(),
      model: { provider: "anthropic", id: "claude-haiku-4-5-20251001" },
      modelRegistry: { find: () => null, getApiKeyForProvider: () => "test-key" },
      sessionManager: { getBranch: () => [] },
      ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, custom: async () => null },
    }
  );

  return result.content[0].text.includes("already active");
});

if (!suite.report()) process.exit(1);
