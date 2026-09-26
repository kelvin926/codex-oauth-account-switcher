import type { ForecastState } from '../shared/forecast';

export function getDemoForecast(): ForecastState {
  const at = new Date().toISOString();
  return { enabled: true, fetchedAt: at, nextRefreshAt: null, stale: false, refreshing: false, error: null,
    data: { generatedAt: at, sources: { record: 'live', timeline: 'live', openaiStatus: 'live' },
      headline: '화면 예시: 초기화 가능성을 확인하는 중입니다.',
      next24Hours: { probability: .592, low: .24, high: .915 }, nearTerm: { hours: 6, probability: .215, low: .062, high: .47 },
      lastResetAt: new Date(Date.now() - 3 * 86400_000).toISOString(), totalResets: 54, resetsLast7Days: 1, resetsLast30Days: 9,
      recentMeanDays: 3.6, recentMedianDays: 2.2, bankedCount: 7,
      accuracy: { status: 'collecting', windows: 14, brier: .14768, baselineBrier: .1443 }, hasMore: false,
      resets: [{ at: new Date(Date.now() - 3 * 86400_000).toISOString(), gapDays: 10.5,
        announcement: { text: '데모용 공지입니다. 실제 게시물은 Lunarwerx 공개 API에서 가져오며 원문 링크로 확인할 수 있습니다.', url: 'https://x.com/thsottiaux', tibo: true } },
        { at: new Date(Date.now() - 13 * 86400_000).toISOString(), gapDays: 2.6, announcement: null }]
    }
  };
}
