import { readJsonWithBackup, writeJsonAtomic } from './atomicFile.js';
import { DEFAULT_SETTINGS, type FeatureSettings, type OperationRecord } from '../shared/features.js';
export function validateSettings(value: FeatureSettings): FeatureSettings {
  if (!value || typeof value.tray!=='boolean' || typeof value.notifications!=='boolean' ||
    ![0,1,2,5,10,15].includes(value.refreshMinutes) || ![5,10,20,30].includes(value.lowRemaining) ||
    !['remaining','reset-first','priority'].includes(value.strategy) || typeof value.forecastEnabled!=='boolean' ||
    typeof value.forecastNotifications!=='boolean' || ![50,60,70,80,90].includes(value.forecastThreshold)) throw new Error('설정 값이 올바르지 않습니다.');
  return {tray:value.tray,notifications:value.notifications,refreshMinutes:value.refreshMinutes,lowRemaining:value.lowRemaining,strategy:value.strategy,
    forecastEnabled:value.forecastEnabled,forecastNotifications:value.forecastNotifications,forecastThreshold:value.forecastThreshold};
}
export class FeatureStore {
  settings: FeatureSettings = {...DEFAULT_SETTINGS};
  operations: OperationRecord[] = [];
  constructor(private readonly file: string) {}
  async load() {
    const {value} = await readJsonWithBackup<any>(this.file,{},(v):v is any => !!v && typeof v==='object');
    try { this.settings=validateSettings({...DEFAULT_SETTINGS,...value.settings}); } catch { this.settings={...DEFAULT_SETTINGS}; }
    this.operations=Array.isArray(value.operations)?value.operations.slice(-200):[];
  }
  async save() { await writeJsonAtomic(this.file,{settings:this.settings,operations:this.operations}); }
  async record(accountId: string|null,stage: string,ok: boolean,message: string) {
    this.operations.push({at:new Date().toISOString(),accountId,stage,ok,message}); this.operations=this.operations.slice(-200); await this.save();
  }
}
