import type { Sensitivity, SupervisorState } from "./types";

export interface AnalysisToken {
  startedAt: number;
  turnCount: number;
  sensitivity: Sensitivity;
  provider: string;
  modelId: string;
}

export function createAnalysisToken(state: SupervisorState): AnalysisToken {
  return {
    startedAt: state.startedAt,
    turnCount: state.turnCount,
    sensitivity: state.sensitivity,
    provider: state.provider,
    modelId: state.modelId,
  };
}

export function getCurrentAnalysisState(
  current: SupervisorState | null,
  token: AnalysisToken
): SupervisorState | null {
  if (current?.active !== true) return null;
  if (current.startedAt !== token.startedAt) return null;
  if (current.turnCount !== token.turnCount) return null;
  if (current.sensitivity !== token.sensitivity) return null;
  if (current.provider !== token.provider) return null;
  if (current.modelId !== token.modelId) return null;
  return current;
}
