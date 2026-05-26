/**
 * model-client — calls the supervisor LLM using OMP's agent session API.
 *
 * callModel        — low-level: returns raw response text
 * callSupervisorModel — high-level: parses response as SteeringDecision
 */

import {
  AgentSession,
  SessionManager,
  Settings,
} from "@oh-my-pi/pi-coding-agent";
import { Agent, convertToLlm } from "@oh-my-pi/pi-agent-core";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { SteeringDecision } from "./types";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Run a one-shot LLM call using OMP's Agent + AgentSession.
 * Returns the raw response text, or null on failure.
 */
export async function callModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<string | null> {
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) return null;

  // Get API key for the provider — the streamFn uses this
  const getApiKey = () => {
    const key = ctx.modelRegistry.getApiKeyForProvider?.(provider);
    return key ?? "";
  };

  const agent = new Agent({
    getApiKey,
    initialState: {
      model,
      systemPrompt: [systemPrompt],
      tools: [],
      messages: [],
    },
    convertToLlm,
    streamFn: (model as any).stream?.bind(model),
  });

  const tempDir = mkdtempSync(join(tmpdir(), "omp-supervisor-"));
  const session = new AgentSession({
    agent,
    sessionManager: SessionManager.inMemory(tempDir),
    settings: Settings.isolated({ "compaction.enabled": false }),
    modelRegistry: ctx.modelRegistry,
    toolRegistry: new Map(),
  });

  const onAbort = () => session.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  let responseText = "";
  const unsubscribe = session.subscribe((event: any) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      responseText += event.assistantMessageEvent.delta;
      onDelta?.(responseText);
    }
  });

  try {
    await session.prompt(userPrompt);
  } catch {
    return null;
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", onAbort);
    session.dispose();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  return responseText;
}

/**
 * Run a one-shot supervisor analysis.
 * Returns { action: "continue" } on any failure so the chat is never interrupted.
 */
export async function callSupervisorModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  const text = await callModel(ctx, provider, modelId, systemPrompt, userPrompt, signal, onDelta);
  if (text === null) return safeContinue("Model call failed");
  return parseDecision(text);
}

// ---- Response parsing ----

function parseDecision(text: string): SteeringDecision {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<SteeringDecision>;
    const action = parsed.action;
    if (action !== "continue" && action !== "steer" && action !== "done") {
      return safeContinue("Invalid action in supervisor response");
    }
    return {
      action,
      message: typeof parsed.message === "string" ? parsed.message.trim() : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return safeContinue("Failed to parse supervisor JSON decision");
  }
}

function safeContinue(reason: string): SteeringDecision {
  return { action: "continue", reasoning: reason, confidence: 0 };
}
