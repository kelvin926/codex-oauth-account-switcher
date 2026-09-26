import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forecastLink, forecastNotices, ForecastService, parseForecast } from '../forecast';
import { DEFAULT_SETTINGS } from '../../shared/features';

const start = Date.parse('2026-09-26T01:00:00Z');
const at = (time = start) => new Date(time).toISOString();
function fixtures(time = start) {
  const common = { apiVersion: '1', generatedAt: at(time), sources: { record: 'live', timeline: 'live', openaiStatus: 'live' } };
  return {
    forecast: { ...common, headline: 'Source forecast', next24Hours: { probability: .592, low: .24, high: .915 }, nearTerm: { hours: 6, probability: .215, low: .062, high: .47 } },
    stats: { ...common, totalResets: 54, lastResetAt: at(start - 86400_000), gaps: { recentMeanDays: 3.6 } },
    history: { ...common, nextOffset: null, resets: [{ at: at(start - 86400_000), gapDays: 2, announcement: { text: '<script>untrusted text</script>', url: 'https://x.com/thsottiaux/status/123456' } }] }
  };
}
describe('Lunarwerx public forecast', () => {
  it('reads documented fractions, keeps missing values unknown, and validates source links', () => {
    const f = fixtures(); const data = parseForecast(f.forecast, f.stats, f.history);
    expect(data.next24Hours.probability).toBe(.592);
    expect(data.bankedCount).toBeNull(); expect(data.accuracy.windows).toBeNull();
    expect(data.resets[0].announcement?.tibo).toBe(true);
    for (const link of ['file:///C:/Windows/test.exe', 'https://x.com.evil.test/thsottiaux/status/123', 'https://x.com@evil.test/test', 'https://user@x.com/thsottiaux', 'javascript:alert(1)', 'https://codex.lunarwerx.com/admin']) expect(forecastLink(link)).toBeNull();
    const bad = { ...f.forecast, next24Hours: { probability: 99, low: .9, high: .1 } };
    expect(parseForecast(bad, f.stats, f.history).next24Hours).toEqual({ probability: null, low: null, high: null });
  });
  it('seeds without old alerts and alerts only new resets and a rising forecast threshold', () => {
    const f = fixtures(); const data = parseForecast(f.forecast, f.stats, f.history);
    const initial = forecastNotices(data, null, 70); expect(initial.notices).toEqual([]);
    expect(forecastNotices(data, initial.cursor, 70).notices).toEqual([]);
    const changed = { ...data, lastResetAt: at(), next24Hours: { ...data.next24Hours, probability: .8 } };
    const update = forecastNotices(changed, initial.cursor, 70); expect(update.notices).toHaveLength(2);
    expect(forecastNotices(changed, update.cursor, 70).notices).toEqual([]);
    const missing = forecastNotices({ ...changed, lastResetAt: null, resets: [], next24Hours: { probability: null, low: null, high: null } }, update.cursor, 70);
    expect(missing.notices).toEqual([]);
    expect(forecastNotices(changed, missing.cursor, 70).notices).toEqual([]);
  });
  it('deduplicates concurrent refreshes, survives restart throttling, and sends no credentials', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forecast-test-')); const file = path.join(root, 'forecast.json');
    let now = start; const notify = vi.fn();
    const request = vi.fn(async (url: any, init: any) => {
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
      expect(Object.keys(init.headers)).toEqual(['Accept']);
      const f = fixtures(now); return new Response(JSON.stringify(String(url).endsWith('forecast') ? f.forecast : String(url).endsWith('stats') ? f.stats : f.history));
    }) as unknown as typeof fetch;
    try {
      const service = new ForecastService(file, () => DEFAULT_SETTINGS, notify, request, () => now);
      await Promise.all([service.refresh(), service.refresh(), service.refresh()]); expect(request).toHaveBeenCalledTimes(3);
      const restarted = new ForecastService(file, () => DEFAULT_SETTINGS, notify, request, () => now); await restarted.load(); await restarted.refresh();
      expect(request).toHaveBeenCalledTimes(3); expect(restarted.state().data?.totalResets).toBe(54);
      now += 300_000; await restarted.refresh(); expect(request).toHaveBeenCalledTimes(6); expect(notify).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('retains good data on 503, honors Retry-After, and never alerts for stale server data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forecast-test-')); let now = start; let mode = 'good'; const notify = vi.fn();
    const request = vi.fn(async (url: any) => {
      if (mode === 'offline') return new Response('{}', { status: 503, headers: { 'Retry-After': '900' } });
      const f = fixtures(mode === 'stale' ? start : now);
      return new Response(JSON.stringify(String(url).endsWith('forecast') ? f.forecast : String(url).endsWith('stats') ? f.stats : f.history));
    }) as unknown as typeof fetch;
    try {
      const service = new ForecastService(path.join(root, 'forecast.json'), () => DEFAULT_SETTINGS, notify, request, () => now);
      await service.refresh(); now += 300_000; mode = 'offline'; await service.refresh();
      expect(service.state()).toMatchObject({ stale: true, data: { generatedAt: at(start) }, nextRefreshAt: at(now + 900_000) });
      now += 300_000; await service.refresh(); expect(request).toHaveBeenCalledTimes(6);
      now += 600_000; mode = 'stale'; await service.refresh();
      expect(service.state().data?.generatedAt).toBe(at(start)); expect(service.state().error).toContain('갱신 시각'); expect(notify).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('persists backoff before the first network request and after an initial failure without cached data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forecast-test-')); const file = path.join(root, 'forecast.json');
    const restartedRequest = vi.fn() as unknown as typeof fetch;
    const request = vi.fn(async () => {
      const inFlightRestart = new ForecastService(file, () => DEFAULT_SETTINGS, vi.fn(), restartedRequest, () => start);
      await inFlightRestart.load(); await inFlightRestart.refresh();
      return new Response('{}', { status: 429, headers: { 'Retry-After': '900' } });
    }) as unknown as typeof fetch;
    try {
      await new ForecastService(file, () => DEFAULT_SETTINGS, vi.fn(), request, () => start).refresh();
      const failedRestart = new ForecastService(file, () => DEFAULT_SETTINGS, vi.fn(), restartedRequest, () => start + 300_000);
      await failedRestart.load(); await failedRestart.refresh();
      expect(restartedRequest).not.toHaveBeenCalled(); expect(failedRestart.state().nextRefreshAt).toBe(at(start + 900_000));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
