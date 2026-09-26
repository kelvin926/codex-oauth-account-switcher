import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomicFile.js';
import { FORECAST_HOME, type ForecastSnapshot, type ForecastState, type ForecastProbability, type ForecastPost } from '../shared/forecast.js';

const INTERVAL = 300_000;
const MAX_AGE = 600_000;
class ForecastResponseError extends Error {
  constructor(status: number, readonly backoff: boolean) {
    super(`Lunarwerx 응답 오류 (HTTP ${status}). 잠시 후 자동으로 다시 확인합니다.`);
  }
}
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value: unknown, limit = 500) => typeof value === 'string' ? value.slice(0, limit) : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const probability = (value: unknown) => number(value) !== null && (value as number) <= 1 ? value as number : null;
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Only documented public sources can be opened. Never accept file:, app links, or credentials.
export function forecastLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'codex.lunarwerx.com' && ['/', '/api'].includes(url.pathname)) return url.href;
    if (['x.com', 'twitter.com'].includes(url.hostname) && /^\/[a-zA-Z0-9_]{1,30}(?:\/status\/\d+)?\/?$/.test(url.pathname)) return url.href;
    if (['openai.com', 'status.openai.com'].includes(url.hostname)) return url.href;
  } catch { /* Untrusted source URL. */ }
  return null;
}
function range(value: unknown): ForecastProbability {
  const data = record(value);
  const result = { probability: probability(data.probability), low: probability(data.low), high: probability(data.high) };
  if (result.low !== null && result.high !== null && result.low > result.high) { result.low = null; result.high = null; }
  return result;
}
export function parseForecast(forecast: unknown, stats: unknown, history: unknown): ForecastSnapshot {
  const f = record(forecast), s = record(stats), h = record(history);
  const dates = [f, s, h].map(v => v.apiVersion === '1' ? timestamp(v.generatedAt) : null);
  if (dates.some(v => !v) || !Array.isArray(h.resets)) throw new Error('Lunarwerx 응답 형식이 변경됐습니다. 원본 사이트를 확인하세요.');
  const source = record(f.sources);
  const accuracy = record(f.liveAccuracy), daily = record(accuracy.twentyFourHours);
  const resets = h.resets.slice(0, 100).flatMap((entry: unknown) => {
    const row = record(entry), at = timestamp(row.at);
    if (!at) return [];
    const announcement = record(row.announcement), url = forecastLink(announcement.url);
    return [{ at, gapDays: number(row.gapDays), announcement: row.announcement ? {
      text: text(announcement.text, 10000), url,
      tibo: !!url && /^https:\/\/(?:x|twitter)\.com\/thsottiaux\/status\/\d+\/?(?:[?#].*)?$/i.test(url)
    } : null }];
  }).sort((a, b) => b.at.localeCompare(a.at));
  return {
    // Use the oldest component, so a partial upstream cache never appears fresher than it is.
    generatedAt: (dates as string[]).sort()[0],
    source: 'api', timelineLive: null, posts: [],
    sources: { record: text(source.record) ?? 'unknown', timeline: text(source.timeline) ?? 'unknown', openaiStatus: text(source.openaiStatus) ?? 'unknown' },
    headline: text(f.headline, 1000) ?? '예상 설명 없음', next24Hours: range(f.next24Hours),
    nearTerm: { ...range(f.nearTerm), hours: number(record(f.nearTerm).hours) },
    lastResetAt: timestamp(s.lastResetAt), totalResets: number(s.totalResets),
    resetsLast7Days: number(s.resetsLast7Days), resetsLast30Days: number(s.resetsLast30Days),
    pace30Days: number(s.resetsLast30Days) ? Math.round(30 / s.resetsLast30Days * 10) / 10 : null,
    recentMeanDays: number(record(s.gaps).recentMeanDays), recentMedianDays: number(record(s.gaps).recentMedianDays),
    bankedCount: number(record(s.banked).count),
    accuracy: { status: text(accuracy.status) ?? 'unavailable', windows: number(daily.windows), brier: number(daily.brier), baselineBrier: number(daily.baselineBrier) },
    resets: [...new Map(resets.map(row => [row.at, row])).values()], hasMore: number(h.nextOffset) !== null
  };
}

// The website's public summary includes prospective posts absent from the v1 reset ledger.
// Keep this adapter separate: its unversioned schema can change, so v1 remains a fallback.
export function parseWebsiteForecast(value: unknown): ForecastSnapshot {
  const body = record(value), stats = record(body.stats), source = record(body.sources), tibo = record(body.tibo);
  if (!timestamp(body.generatedAt) || number(stats.totalTracked) === null || !Array.isArray(body.recent)
    || probability(body.chanceToday) === null || probability(body.chanceSoon) === null) {
    throw new Error('Lunarwerx 사이트 피드 형식이 변경됐습니다.');
  }
  const common = { apiVersion: '1', generatedAt: body.generatedAt, sources: { record: source.record, timeline: tibo.source, openaiStatus: source.status } };
  const data = parseForecast({ ...common, headline: body.headline, liveAccuracy: body.liveAccuracy,
    next24Hours: { probability: body.chanceToday, low: body.chanceLow, high: body.chanceHigh },
    nearTerm: { hours: body.soonWindowHours, probability: body.chanceSoon, low: body.chanceSoonLow, high: body.chanceSoonHigh }
  }, { ...common, lastResetAt: body.lastReset, totalResets: stats.totalTracked, resetsLast7Days: stats.last7Days, resetsLast30Days: stats.last30Days,
    gaps: { recentMeanDays: stats.meanGapDays, recentMedianDays: stats.medianGapDays }, banked: body.banked
  }, { ...common, nextOffset: body.recent.length > 100 ? 100 : null, resets: body.recent.slice(0, 100).map((value: unknown) => {
    const row = record(value); return { at: row.at, gapDays: row.gapDays, announcement: row.s || row.u ? { text: row.s, url: row.u } : null };
  }) });
  const posts = [tibo.tweets, tibo.more].flatMap(rows => Array.isArray(rows) ? rows.slice(0, 100) : []).flatMap((value: unknown): ForecastPost[] => {
    const row = record(value), at = timestamp(row.at), url = forecastLink(row.url), content = text(row.text, 10000);
    if (!at || !url || !content || !/^https:\/\/(?:x|twitter)\.com\/thsottiaux\/status\/\d+\/?(?:[?#].*)?$/i.test(url)) return [];
    return [{ at, url, text: content, kind: row.pendingReset === true ? 'incoming' : row.relevance === 'reset' ? 'reset' : row.relevance === 'hint' ? 'hint' : 'watch', why: text(row.why) }];
  }).sort((a, b) => b.at.localeCompare(a.at));
  return { ...data, source: 'website', pace30Days: number(stats.pace30Days),
    timelineLive: Array.isArray(tibo.tweets) && typeof tibo.feedLive === 'boolean' ? tibo.feedLive : null,
    posts: [...new Map(posts.map(post => [post.url, post])).values()] };
}

function parseCachedForecast(raw: unknown[]): ForecastSnapshot {
  if (raw.length === 1) return parseWebsiteForecast(raw[0]);
  if (raw.length === 3) return parseForecast(...raw as [unknown, unknown, unknown]);
  throw new Error('Lunarwerx 저장 형식 오류');
}

type AlertCursor = { lastResetAt: string | null; announcements: string[]; above: boolean };
export type ForecastNotice = { title: string; body: string };
export function forecastNotices(data: ForecastSnapshot, previous: AlertCursor | null, threshold: number): { cursor: AlertCursor; notices: ForecastNotice[] } {
  const announcements = [...data.posts.map(post => post.url), ...data.resets.flatMap(row => row.announcement?.url ? [row.announcement.url] : [])];
  const above = data.next24Hours.probability === null ? previous?.above ?? false : data.next24Hours.probability * 100 >= threshold;
  const cursor = {
    lastResetAt: [previous?.lastResetAt, data.lastResetAt].filter((at): at is string => !!at).sort().at(-1) ?? null,
    announcements: [...new Set([...announcements, ...(previous?.announcements ?? [])])].slice(0, 500), above
  };
  if (!previous) return { cursor, notices: [] }; // No historical alert burst on first launch.
  const notices: ForecastNotice[] = [];
  const newPost = data.timelineLive === true && data.posts.find(post => !previous.announcements.includes(post.url)
    && Date.parse(data.generatedAt) >= Date.parse(post.at) && Date.parse(data.generatedAt) - Date.parse(post.at) < 48 * 3600_000);
  if (newPost) notices.push({ title: newPost.kind === 'incoming' ? 'Tibo의 Codex 초기화 예고' : 'Tibo의 Codex 소식',
    body: 'Lunarwerx에 새 게시물이 추가됐습니다. 예고와 초기화 완료 기록은 다르며, 내 계정의 적용 여부는 잔여량에서 확인하세요.' });
  if (data.lastResetAt && (!previous.lastResetAt || data.lastResetAt > previous.lastResetAt)) {
    notices.push({ title: '새 Codex 초기화 기록', body: 'Lunarwerx에 초기화 또는 초기화권 지급 기록이 추가됐습니다. 내 계정의 적용 여부는 잔여량을 갱신해 확인하세요.' });
  } else if (!newPost && data.resets.some(row => row.announcement?.url && !previous.announcements.includes(row.announcement.url) && Date.parse(data.generatedAt) >= Date.parse(row.at) && Date.parse(data.generatedAt) - Date.parse(row.at) < 48 * 3600_000)) {
    notices.push({ title: 'Codex 초기화 공지 업데이트', body: 'Lunarwerx 초기화 기록에 새 원문 공지가 연결됐습니다. 눌러서 Tibo 게시물과 출처를 확인하세요.' });
  }
  if (above && !previous.above) notices.push({ title: 'Codex 초기화 예상 지수 상승', body: `Lunarwerx의 24시간 내 예상 확률이 ${(data.next24Hours.probability! * 100).toFixed(1)}%입니다. 제3자 통계 추정이며 초기화 확정 공지가 아닙니다.` });
  return { cursor, notices };
}

export class ForecastService {
  private data: ForecastSnapshot | null = null;
  private raw: unknown[] | null = null;
  private fetchedAt: string | null = null;
  private nextRefresh = 0;
  private error: string | null = null;
  private cursor: AlertCursor | null = null;
  private pending: Promise<ForecastState> | null = null;
  constructor(private readonly file: string, private readonly settings: () => { forecastEnabled: boolean; forecastNotifications: boolean; forecastThreshold: number }, private readonly notify: (notice: ForecastNotice) => void, private readonly request: typeof fetch = fetch, private readonly clock = Date.now) {}
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (![1, 2].includes(saved.version)) return;
      // Backoff also matters when no successful snapshot has been cached yet.
      this.nextRefresh = Math.min(number(saved.nextRefresh) ?? 0, this.clock() + 86400_000);
      if (!Array.isArray(saved.raw)) return;
      this.data = parseCachedForecast(saved.raw); this.raw = saved.raw;
      this.fetchedAt = timestamp(saved.fetchedAt);
      const savedCursor = record(saved.cursor);
      const previous = typeof savedCursor.above === 'boolean' && Array.isArray(savedCursor.announcements)
        ? { above: savedCursor.above, lastResetAt: timestamp(savedCursor.lastResetAt), announcements: savedCursor.announcements.slice(0, 500).map(forecastLink).filter((url: string | null): url is string => !!url) } : null;
      this.cursor = forecastNotices(this.data, previous, this.settings().forecastThreshold).cursor;
    } catch { /* A disposable public cache must never prevent account switching. */ }
  }
  state(): ForecastState {
    const age = this.data ? this.clock() - Date.parse(this.data.generatedAt) : Infinity;
    return { enabled: this.settings().forecastEnabled, data: this.data, fetchedAt: this.fetchedAt, nextRefreshAt: this.nextRefresh ? new Date(this.nextRefresh).toISOString() : null,
      stale: age > MAX_AGE || age < -60_000, refreshing: !!this.pending, error: this.error };
  }
  refresh(): Promise<ForecastState> {
    if (this.pending) return this.pending;
    if (!this.settings().forecastEnabled || this.clock() < this.nextRefresh) return Promise.resolve(this.state());
    this.pending = this.fetchData().finally(() => { this.pending = null; });
    return this.pending.then(() => this.state());
  }
  private async get(endpoint: string): Promise<unknown> {
    const init = { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) } as const;
    const response = await this.request(`${FORECAST_HOME}${endpoint}`, init);
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
      const retryAt = seconds !== null ? this.clock() + seconds * 1000 : retry ? Date.parse(retry) : NaN;
      if (Number.isFinite(retryAt)) this.nextRefresh = Math.max(this.nextRefresh, Math.min(retryAt, this.clock() + 86400_000));
      await response.body?.cancel();
      throw new ForecastResponseError(response.status, response.status === 429 || Number.isFinite(retryAt));
    }
    if (!response.body) throw new Error('Lunarwerx 응답이 비어 있습니다.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2_000_000) throw new Error('Lunarwerx 응답 크기 초과'); chunks.push(value); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  private async save() {
    try {
      await writeFileAtomic(this.file, JSON.stringify({ version: 2, raw: this.raw, fetchedAt: this.fetchedAt, nextRefresh: this.nextRefresh, cursor: this.cursor }));
    } catch { /* A disposable cache failure must not block live updates. In-memory throttling still applies. */ }
  }
  private validateFreshness(data: ForecastSnapshot) {
    const age = this.clock() - Date.parse(data.generatedAt);
    if (age > MAX_AGE || age < -60_000) throw new Error('Lunarwerx 데이터의 갱신 시각이 오래됐거나 PC 시각과 맞지 않습니다. 마지막 정상 기록을 표시합니다.');
    if (this.data && data.generatedAt < this.data.generatedAt) throw new Error('이전 시점의 응답이 도착해 최신 기록을 유지합니다.');
  }
  private async fetchData(): Promise<ForecastState> {
    this.nextRefresh = this.clock() + INTERVAL;
    try {
      await this.save(); // A restart during a slow request must preserve the polling limit.
      let raw: unknown[], data: ForecastSnapshot;
      try {
        raw = [await this.get(`cnx/aireset/summary/t/${Math.floor(this.clock() / INTERVAL)}`)];
        data = parseCachedForecast(raw); this.validateFreshness(data);
      } catch (error) {
        if (error instanceof ForecastResponseError && error.backoff) throw error;
        const responses = await Promise.allSettled(['forecast', 'stats', 'resets?limit=100'].map(endpoint => this.get(`api/v1/${endpoint}`)));
        const failure = responses.find(r => r.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        raw = responses.map(r => (r as PromiseFulfilledResult<unknown>).value);
        data = parseCachedForecast(raw); this.validateFreshness(data);
      }
      const { cursor, notices } = forecastNotices(data, this.cursor, this.settings().forecastThreshold);
      this.raw = raw; this.data = data; this.fetchedAt = new Date(this.clock()).toISOString(); this.error = null; this.cursor = cursor;
      await this.save();
      if (this.settings().forecastEnabled && this.settings().forecastNotifications) for (const notice of notices) {
        try { this.notify(notice); } catch { /* Notification delivery does not change data freshness. */ }
      }
    } catch (error) {
      this.error = error instanceof Error && /Lunarwerx|시점/.test(error.message) ? error.message : 'Lunarwerx에 연결하지 못했습니다. 마지막 기록을 유지하며 5분 이후 다시 시도합니다.';
      await this.save().catch(() => {});
    }
    return this.state();
  }
}
