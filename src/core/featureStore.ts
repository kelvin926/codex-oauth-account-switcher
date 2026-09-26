import { readJsonWithBackup, writeJsonAtomic } from './atomicFile.js';
import type { QuotaNoticeState } from './quotaNotifications.js';
import { DEFAULT_SETTINGS, LOW_REMAINING_OPTIONS, type FeatureSettings, type OperationRecord } from '../shared/features.js';
export function validateSettings(value: FeatureSettings): FeatureSettings {
  if (!value || typeof value.startAtLogin!=='boolean' || typeof value.weeklyResetNotifications!=='boolean' || typeof value.tray!=='boolean' || typeof value.notifications!=='boolean' ||
    ![0,1,2,5,10,15].includes(value.refreshMinutes) || !LOW_REMAINING_OPTIONS.includes(value.lowRemaining) ||
    !['remaining','reset-first','priority'].includes(value.strategy) || typeof value.forecastEnabled!=='boolean' ||
    typeof value.forecastNotifications!=='boolean' || ![50,60,70,80,90].includes(value.forecastThreshold)) throw new Error('설정 값이 올바르지 않습니다.');
  return {startAtLogin:value.startAtLogin,weeklyResetNotifications:value.weeklyResetNotifications,tray:value.tray,notifications:value.notifications,refreshMinutes:value.refreshMinutes,lowRemaining:value.lowRemaining,strategy:value.strategy,
    forecastEnabled:value.forecastEnabled,forecastNotifications:value.forecastNotifications,forecastThreshold:value.forecastThreshold};
}
export class FeatureStore {
  settings: FeatureSettings = {...DEFAULT_SETTINGS};
  operations: OperationRecord[] = [];
  quotaStates: Record<string, QuotaNoticeState> = {};
  startupConfigured = false;
  private saving: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async load() {
    const {value} = await readJsonWithBackup<any>(this.file,{},(v):v is any => !!v && typeof v==='object');
    try { this.settings=validateSettings({...DEFAULT_SETTINGS,...value.settings}); } catch { this.settings={...DEFAULT_SETTINGS}; }
    this.startupConfigured = value.startupConfigured === true;
    this.quotaStates = Object.fromEntries(Object.entries(value.quotaStates ?? {}).filter((entry): entry is [string, QuotaNoticeState] => {
      const s = entry[1] as QuotaNoticeState | null;
      return !!s && typeof s.at === 'string' && Number.isFinite(Date.parse(s.at)) && typeof s.low === 'boolean' && (s.used === null || (typeof s.used === 'number' && Number.isFinite(s.used) && s.used >= 0 && s.used <= 100));
    }));
    this.operations=Array.isArray(value.operations)?value.operations.slice(-200):[];
  }
  async save() {
    const next = this.saving.then(() => writeJsonAtomic(this.file,{settings:this.settings,operations:this.operations,quotaStates:this.quotaStates,startupConfigured:this.startupConfigured}));
    this.saving = next.catch(() => {}); return next;
  }
  async record(accountId: string|null,stage: string,ok: boolean,message: string) {
    this.operations.push({at:new Date().toISOString(),accountId,stage,ok,message}); this.operations=this.operations.slice(-200); await this.save();
  }
}
