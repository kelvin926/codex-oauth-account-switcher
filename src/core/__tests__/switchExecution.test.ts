import { describe, expect, it } from 'vitest';
import {
  createSwitchExecutionPlan,
  MANUAL_SWITCH_REQUIRES_CLOSED_APP,
  normalizeAutoRestartOnSwitch
} from '../switchExecution';

describe('normalizeAutoRestartOnSwitch', () => {
  it('defaults existing app state to automatic restart', () => {
    expect(normalizeAutoRestartOnSwitch(undefined)).toBe(true);
    expect(normalizeAutoRestartOnSwitch('false')).toBe(true);
  });

  it('preserves an explicit manual-mode setting', () => {
    expect(normalizeAutoRestartOnSwitch(false)).toBe(false);
  });
});

describe('createSwitchExecutionPlan', () => {
  it('stops a running app and relaunches it in automatic mode', () => {
    expect(createSwitchExecutionPlan(true, true)).toEqual({
      shouldStop: true,
      shouldLaunch: true
    });
  });

  it('launches the app after switching even when it was already closed in automatic mode', () => {
    expect(createSwitchExecutionPlan(true, false)).toEqual({
      shouldStop: true,
      shouldLaunch: true
    });
  });

  it('keeps the app closed in manual mode', () => {
    expect(createSwitchExecutionPlan(false, false)).toEqual({
      shouldStop: false,
      shouldLaunch: false
    });
  });

  it('blocks a live auth swap in manual mode', () => {
    expect(() => createSwitchExecutionPlan(false, true)).toThrow(
      MANUAL_SWITCH_REQUIRES_CLOSED_APP
    );
  });
});
