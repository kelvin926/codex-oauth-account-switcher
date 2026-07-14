import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardPayload } from './shared/desktopApi';
import { SummaryBar } from './features/accounts/components/SummaryBar';
import { AddAccountModal } from './features/accounts/components/AddAccountModal';
import { AccountCard } from './features/accounts/components/AccountCard';
import { chooseRecommendedAccount } from './core/recommendation';
import { sortAccounts } from './features/accounts/state';
import { getRegistrationHelpText } from './features/registration/registerAccountFlow';
import { getDemoDashboard, readDemoScenario } from './demo/demoData';

type AsyncStatus = {
  kind: 'idle' | 'error' | 'success';
  message: string;
};

export default function App() {
  const switchAppliedMessage = '계정 전환이 완료되었습니다. 채팅과 설정은 그대로 유지됩니다.';
  const demoScenario = useMemo(() => readDemoScenario(window.location.search), []);
  const isDemoMode = demoScenario !== null;
  const demoDashboard = useMemo(
    () => (demoScenario ? getDemoDashboard(demoScenario) : null),
    [demoScenario]
  );
  const startupRefreshAttemptedRef = useRef(false);
  const [dashboard, setDashboard] = useState<DashboardPayload>({
    accounts: demoDashboard?.accounts ?? [],
    state:
      demoDashboard?.state ?? {
        activeAccountId: null,
        pendingVerificationAccountId: null,
        pendingVerificationSawStop: false,
        lastSwitchAt: null,
        registration: null
      }
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<AsyncStatus>({ kind: 'idle', message: '' });

  const recommended = useMemo(
    () => chooseRecommendedAccount(dashboard.accounts),
    [dashboard.accounts]
  );
  const sortedAccounts = useMemo(
    () => sortAccounts(dashboard.accounts, dashboard.state),
    [dashboard.accounts, dashboard.state]
  );

  useEffect(() => {
    if (demoDashboard) {
      setDashboard(demoDashboard);
      return;
    }

    let cancelled = false;

    async function loadDashboardWithStartupRefresh() {
      try {
        const initialDashboard = await window.desktopApi.getDashboard();
        if (cancelled) return;

        setDashboard(initialDashboard);
        if (initialDashboard.accounts.length === 0 || startupRefreshAttemptedRef.current) return;

        startupRefreshAttemptedRef.current = true;
        const refreshedDashboard = await window.desktopApi.refreshAll();
        if (!cancelled) setDashboard(refreshedDashboard);
      } catch (error) {
        if (!cancelled) {
          setStatus({
            kind: 'error',
            message: error instanceof Error ? error.message : '예상하지 못한 오류가 발생했습니다.'
          });
        }
      }
    }

    void loadDashboardWithStartupRefresh();
    return () => {
      cancelled = true;
    };
  }, [demoDashboard]);

  useEffect(() => {
    if (isDemoMode) return;

    const intervalId = window.setInterval(() => {
      void window.desktopApi.getDashboard().then(setDashboard).catch(() => {
        // Keep the last good state visible during a transient file or process transition.
      });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [isDemoMode]);

  useEffect(() => {
    if (
      status.kind === 'success' &&
      status.message.includes('다시 여는 중') &&
      dashboard.state.pendingVerificationAccountId === null &&
      status.message !== switchAppliedMessage
    ) {
      setStatus({ kind: 'success', message: switchAppliedMessage });
    }
  }, [dashboard.state.pendingVerificationAccountId, status, switchAppliedMessage]);

  const activeAccount = dashboard.accounts.find(
    (account) => account.id === dashboard.state.activeAccountId
  );

  async function runAction(action: () => Promise<DashboardPayload>, successMessage: string) {
    if (isDemoMode) {
      setStatus({
        kind: 'success',
        message: '공개 저장소용 데모 화면입니다. 실제 계정 정보는 사용하지 않습니다.'
      });
      return;
    }

    try {
      const next = await action();
      setDashboard(next);
      setStatus({ kind: 'success', message: successMessage });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '예상하지 못한 오류가 발생했습니다.'
      });
    }
  }

  const bannerMessage =
    status.kind === 'idle'
      ? isDemoMode
        ? '공개 저장소용 데모 화면입니다. 실제 계정 정보 없이 기능 예시만 표시합니다.'
        : getRegistrationHelpText(dashboard.state.registration)
      : status.message;

  return (
    <main className="app-shell">
      <SummaryBar
        activeLabel={activeAccount?.label ?? '로그인 확인 필요'}
        recommendedLabel={recommended?.label ?? '등록된 계정 없음'}
        recommendedDisabled={!recommended || recommended.id === activeAccount?.id}
        onSwitchRecommended={() =>
          void runAction(
            () => window.desktopApi.switchRecommendedAccount(),
            '추천 계정으로 전환했습니다. ChatGPT를 다시 여는 중입니다.'
          )
        }
        onRefreshAll={() =>
          void runAction(
            () => window.desktopApi.refreshAll(),
            '모든 계정의 사용량을 다시 불러왔습니다.'
          )
        }
        onTerminateCodex={() =>
          void runAction(
            () => window.desktopApi.terminateCodex(),
            'ChatGPT/Codex를 안전하게 종료했습니다.'
          )
        }
        onAddAccount={() => setModalOpen(true)}
      />

      <section className={`status-banner ${status.kind}`}>
        <strong>{status.kind === 'error' ? '오류' : '안내'}</strong>
        <span>{bannerMessage}</span>
      </section>

      <section className="card-grid">
        {sortedAccounts.length === 0 ? (
          <div className="empty-state">
            <h2>아직 등록된 계정이 없습니다</h2>
            <p>
              ChatGPT/Codex에 로그인된 계정을 저장하세요. 기존 채팅, 프로젝트, 플러그인과
              설정은 공용 Codex 홈에 그대로 유지됩니다.
            </p>
          </div>
        ) : null}

        {sortedAccounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            state={dashboard.state}
            recommendedId={recommended?.id ?? null}
            onRefresh={() =>
              void runAction(
                () => window.desktopApi.refreshAccount(account.id),
                `${account.label} 계정 사용량을 다시 불러왔습니다.`
              )
            }
            onDelete={() =>
              void runAction(
                () => window.desktopApi.deleteAccount(account.id),
                `${account.label} 계정을 저장 목록에서 제거했습니다.`
              )
            }
            onSwitch={() =>
              void runAction(
                () => window.desktopApi.switchAccount(account.id),
                `${account.label} 계정으로 전환했습니다. ChatGPT를 다시 여는 중입니다.`
              )
            }
          />
        ))}
      </section>

      <AddAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCapture={async (label) => {
          await runAction(
            () => window.desktopApi.captureCurrentAuth({ label }),
            '현재 인증을 안전하게 저장했습니다. 이미 있던 계정이면 최신 토큰으로 갱신했습니다.'
          );
          setModalOpen(false);
        }}
      />
    </main>
  );
}
