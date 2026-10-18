export const GLOBAL_ASSISTANT_COMMAND_EVENT = "omni:assistant-command";

export interface GlobalAssistantCommand {
  goal: string;
  capabilityId?: string;
  input?: Record<string, unknown>;
}

export const openGlobalAssistant = (command?: GlobalAssistantCommand) => {
  window.dispatchEvent(new CustomEvent<GlobalAssistantCommand | undefined>(GLOBAL_ASSISTANT_COMMAND_EVENT, {
    detail: command,
  }));
};
