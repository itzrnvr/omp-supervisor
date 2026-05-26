export class AgentRunSteeringTracker {
  private currentRunId = 0;
  private steeredRunId = -1;

  startRun(): number {
    this.currentRunId++;
    return this.currentRunId;
  }

  getCurrentRunId(): number {
    return this.currentRunId;
  }

  hasSteered(runId = this.currentRunId): boolean {
    return this.steeredRunId === runId;
  }

  tryMarkSteered(runId = this.currentRunId): boolean {
    if (runId !== this.currentRunId) return false;
    if (this.steeredRunId === runId) return false;
    this.steeredRunId = runId;
    return true;
  }
}
