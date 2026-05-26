import type { ConversationMessage } from "./types";

const MAX_TEXT_CHARS = 6_000;
const MAX_JSON_CHARS = 2_000;

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function truncate(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

function stringify(value: unknown, max = MAX_JSON_CHARS): string {
  try {
    const json = JSON.stringify(value);
    return truncate(json ?? String(value), max);
  } catch {
    return "[unserializable]";
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return truncate(content.trim());
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (text) parts.push(text);
    } else if (block.type === "image") {
      const mimeType = typeof block.mimeType === "string" ? block.mimeType : "image";
      parts.push(`[${mimeType} attached]`);
    }
  }

  return truncate(parts.join("\n").trim());
}

function extractToolCalls(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const calls: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "toolCall") continue;

    const name = typeof block.name === "string" ? block.name : "unknown_tool";
    const id = typeof block.id === "string" ? ` id=${block.id}` : "";
    const args = "arguments" in block ? stringify(block.arguments) : "{}";
    calls.push(`TOOL CALL: ${name}${id}\nargs: ${args}`);
  }

  return calls;
}

function assistantContent(message: RecordLike): string {
  const parts: string[] = [];
  const text = extractText(message.content);
  if (text) parts.push(text);
  parts.push(...extractToolCalls(message.content));

  if (message.stopReason === "error" || message.stopReason === "aborted") {
    const error = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
    parts.push(`ASSISTANT ${String(message.stopReason).toUpperCase()}: ${error || "no error message"}`);
  }

  return parts.join("\n").trim();
}

function toolResultContent(message: RecordLike): string {
  const toolName = typeof message.toolName === "string" ? message.toolName : "unknown_tool";
  const callId = typeof message.toolCallId === "string" ? ` id=${message.toolCallId}` : "";
  const status = message.isError === true ? "ERROR" : "OK";
  const output = extractText(message.content) || "(no text output)";
  const details = message.details === undefined ? "" : `\ndetails: ${stringify(message.details, 1_000)}`;
  return `TOOL RESULT: ${toolName} ${status}${callId}\n${output}${details}`;
}

function bashExecutionContent(message: RecordLike): string {
  if (message.excludeFromContext === true) return "";

  const command = typeof message.command === "string" ? message.command : "";
  const output = typeof message.output === "string" ? message.output.trim() : "";
  const exitCode = message.exitCode === undefined ? "unknown" : String(message.exitCode);
  const cancelled = message.cancelled === true ? " cancelled" : "";
  const truncated = message.truncated === true ? " truncated" : "";
  const fullOutputPath = typeof message.fullOutputPath === "string" ? `\nfullOutputPath: ${message.fullOutputPath}` : "";

  return `USER BASH: ${command}\nexitCode: ${exitCode}${cancelled}${truncated}\n${truncate(output || "(no output)")}${fullOutputPath}`;
}

/**
 * Build the supervisor's recent conversation snapshot from OMP session entries.
 *
 * OMP stores tool calls inside assistant messages and tool outputs as separate
 * `role: "toolResult"` messages, so a text-only transcript loses critical
 * evidence such as shell output and tool protocol errors.
 */
export function buildSnapshotFromBranch(entries: unknown[], limit: number): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;

    const msg = entry.message;
    if (msg.role === "user") {
      const content = extractText(msg.content);
      if (content) messages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const content = assistantContent(msg);
      if (content) messages.push({ role: "assistant", content });
    } else if (msg.role === "toolResult") {
      messages.push({ role: "tool", content: toolResultContent(msg) });
    } else if (msg.role === "bashExecution") {
      const content = bashExecutionContent(msg);
      if (content) messages.push({ role: "tool", content });
    }
  }

  return messages.slice(-limit);
}
