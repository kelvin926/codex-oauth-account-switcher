export const MANUAL_SWITCH_REQUIRES_CLOSED_APP =
  '자동 종료·재시작이 꺼져 있습니다. 먼저 빨간색 "ChatGPT/Codex 종료" 버튼을 누른 뒤 다시 전환해 주세요.';

export type SwitchExecutionPlan = {
  shouldStop: boolean;
  shouldLaunch: boolean;
};

export function normalizeAutoRestartOnSwitch(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

export function createSwitchExecutionPlan(
  autoRestartOnSwitch: boolean,
  codexIsOpen: boolean
): SwitchExecutionPlan {
  if (!autoRestartOnSwitch && codexIsOpen) {
    throw new Error(MANUAL_SWITCH_REQUIRES_CLOSED_APP);
  }

  return {
    shouldStop: autoRestartOnSwitch,
    shouldLaunch: autoRestartOnSwitch
  };
}
