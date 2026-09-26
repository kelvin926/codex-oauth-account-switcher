import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { readJsonWithBackup, writeFileAtomic } from '../atomicFile.js';
import { getUsageWindows } from '../usageWindows.js';
import type { UsageSnapshot } from '../types.js';
import type { AnalyticsQuery, QuotaObservation, UsageEvent } from '../../shared/features.js';
import { createParserState, parseRolloutLine, type ParserState } from './parser.js';
import { queryAnalytics, type AccountSpan } from './query.js';

type Cursor = { offset: number; size: number; modified: number; skipping: boolean; state: ParserState };
type StoredEvent = UsageEvent & { file: string };
type Database = { version: 1; files: Record<string, Cursor>; events: StoredEvent[]; observations: QuotaObservation[]; spans: AccountSpan[]; truncated: boolean; scannedAt: string | null };
const blank = (): Database => ({ version: 1, files: {}, events: [], observations: [], spans: [], truncated: false, scannedAt: null });
const CHUNK = 512 * 1024;
const MAX_EVENTS = 250_000;

export class AnalyticsStore {
  private db: Database = blank();
  private loaded = false;
  private saving: Promise<void> = Promise.resolve();
  private scanning: Promise<void> | null = null;
  private lastPulse: { at: string; accountId: string | null } | null = null;
  private warnings: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly root: string, private readonly codexHome: string) {}
  private get file() { return path.join(this.root, 'analytics.json'); }
  async load() {
    if (this.loaded) return;
    const read = await readJsonWithBackup(this.file, blank(), (v): v is Database => {
      const d = v as Database | null;
      return d?.version === 1 && Array.isArray(d.events) && Array.isArray(d.observations) && Array.isArray(d.spans) && !!d.files;
    });
    this.db = read.value; this.loaded = true;
    if (read.recovered) this.warnings.push('분석 저장소를 복구했습니다. 원본 로그에서 다시 읽을 수 있습니다.');
  }
  async save() {
    const next = this.saving.then(()=>writeFileAtomic(this.file, JSON.stringify(this.db)));
    this.saving = next.catch(()=>{});
    return next;
  }
  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.save().catch(() => { this.warnings.push('분석 기록 저장에 실패했습니다.'); }); }, 1500);
  }
  async settle() { await this.scanning; await this.flush(); }
  async flush() { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; } await this.save(); }
  pulse(accountId: string | null, now = new Date()) {
    const at = now.toISOString(); const prior = this.lastPulse;
    if (prior?.accountId && prior.accountId === accountId && Date.parse(at)-Date.parse(prior.at) <= 90_000) {
      const span = this.db.spans.at(-1);
      if (span && span.accountId === accountId && span.end === prior.at) span.end = at;
      else this.db.spans.push({ start: prior.at, end: at, accountId });
    }
    this.lastPulse = { at, accountId };
  }
  async observe(accountId: string, usage: UsageSnapshot) {
    await this.load();
    const week = getUsageWindows(usage).find(w => w.seconds === 604800);
    if (this.db.observations.some(o=>o.accountId === accountId && o.at === usage.fetchedAt)) return;
    this.db.observations.push({ at: usage.fetchedAt, accountId, weeklyUsed: week ? 100-week.remaining : null, resetAt: week?.resetAt ?? null, credits: usage.credits?.balance ?? null });
    if (this.db.observations.length > 100_000) { this.db.observations.splice(0, this.db.observations.length - 100_000); this.db.truncated = true; }
    this.scheduleSave();
  }
  async scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this.scanInternal().finally(()=>{this.scanning=null;});
    return this.scanning;
  }
  private async scanInternal() {
    await this.load();
    this.warnings = [];
    const files: string[] = [];
    const visit = async (directory: string) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warnings.push('일부 세션 폴더에 접근하지 못했습니다.'); return; }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory,entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file);
      }
    };
    await visit(path.join(this.codexHome,'sessions'));
    await visit(path.join(this.codexHome,'archived_sessions'));
    if (!files.length) this.warnings.push('로컬 Codex 세션 JSONL이 없습니다. 이 PC에 저장된 기록부터 표시됩니다.');
    let budget = 64 * 1024 * 1024;
    for (const file of files.sort().reverse()) {
      if (budget <= 0) break;
      const key = path.relative(this.codexHome,file);
      try {
        const info = await stat(file);
        let cursor = this.db.files[key];
        if (!cursor || info.size < cursor.offset || (info.size === cursor.size && info.mtimeMs !== cursor.modified)) {
          this.db.events = this.db.events.filter(e=>e.file!==key);
          cursor = { offset: 0, size: info.size, modified: info.mtimeMs, skipping: false, state: createParserState(path.basename(file)) };
          this.db.files[key] = cursor;
        }
        cursor.size = info.size; cursor.modified = info.mtimeMs;
        if (cursor.offset >= info.size) continue;
        const handle = await open(file,'r');
        try {
          while (cursor.offset < info.size && budget > 0) {
            const buffer = Buffer.alloc(Math.min(CHUNK,info.size-cursor.offset));
            const { bytesRead } = await handle.read(buffer,0,buffer.length,cursor.offset);
            if (!bytesRead) break;
            budget -= bytesRead;
            const end = buffer.subarray(0,bytesRead).lastIndexOf(10);
            if (end < 0) {
              if (bytesRead < CHUNK) break; // Keep an incomplete tail for the next pass.
              cursor.offset += bytesRead; cursor.skipping = true; cursor.state.skipped++; continue;
            }
            const lines = buffer.subarray(0,end+1).toString('utf8').split('\n');
            if (cursor.skipping) { lines.shift(); cursor.skipping=false; }
            for (const line of lines) {
              const event = parseRolloutLine(line,cursor.state);
              if (event) this.db.events.push({ ...event, file: key });
            }
            cursor.offset += end+1;
            await setImmediate();
          }
        } finally { await handle.close(); }
      } catch { this.warnings.push(`읽지 못한 세션: ${path.basename(file)}`); }
    }
    if (this.db.events.length > MAX_EVENTS) {
      this.db.events.sort((a,b)=>a.at.localeCompare(b.at));
      this.db.events.splice(0,this.db.events.length-MAX_EVENTS); this.db.truncated = true;
    }
    this.db.scannedAt = new Date().toISOString();
    await this.flush();
  }
  latestQuotaObservations() {
    const latest = new Map<string, QuotaObservation>();
    for (const row of this.db.observations) if (row.weeklyUsed !== null && (!latest.has(row.accountId) || row.at > latest.get(row.accountId)!.at)) latest.set(row.accountId,row);
    return [...latest.values()];
  }
  async query(query: AnalyticsQuery) {
    await this.load();
    const result = queryAnalytics(this.db.events,this.db.observations,this.db.spans,query);
    const skipped = Object.values(this.db.files).reduce((sum,c)=>sum+c.state.skipped,0);
    return { ...result, scannedAt: this.db.scannedAt, files: Object.keys(this.db.files).length,
      pendingFiles: Object.values(this.db.files).filter(c=>c.offset<c.size).length,
      warnings: [...new Set([...this.warnings,
        ...(skipped ? [`누적값 변경, 누락 또는 읽을 수 없는 기록 ${skipped}건은 임의로 배분하지 않았습니다.`] : []),
        ...(this.db.truncated ? ['저장 한도: 최근 토큰 기록 25만 건, 한도 관측 10만 건. 이전 자료 일부는 제외됐습니다.'] : [])])]
    };
  }
}
