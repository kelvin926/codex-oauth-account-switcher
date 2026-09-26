import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardPayload } from './shared/desktopApi';
import { SummaryBar } from './features/accounts/components/SummaryBar';
import { AddAccountModal } from './features/accounts/components/AddAccountModal';
import { AccountCard } from './features/accounts/components/AccountCard';
import { chooseRecommendedAccount } from './core/recommendation';
import { sortAccounts } from './features/accounts/state';
import { getRegistrationHelpText } from './features/registration/registerAccountFlow';
import { getDemoDashboard, readDemoScenario } from './demo/demoData';

import { AnalyticsPanel } from './features/analytics/AnalyticsPanel';
import { ToolsPanel } from './features/tools/ToolsPanel';
import type { FeatureState } from './shared/features';

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
  const actionPendingRef = useRef(false);
  const actionVersionRef = useRef(0);
  const [busy, setBusy] = useState(!isDemoMode);
  const [dashboard, setDashboard] = useState<DashboardPayload>({
    accounts: demoDashboard?.accounts ?? [],
    state:
      demoDashboard?.state ?? {
        activeAccountId: null,
        pendingVerificationAccountId: null,
        pendingVerificationSawStop: false,
        autoRestartOnSwitch: true,
        lastSwitchAt: null,
        registration: null
      }
  });
  const [tab,setTab] = useState<'accounts'|'analytics'|'tools'>(()=>isDemoMode && new URLSearchParams(window.location.search).get('tab')==='analytics'?'analytics':'accounts');
  const [featureState,setFeatureState] = useState<FeatureState|null>(null);
  const [reauthId,setReauthId] = useState<string|undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<AsyncStatus>({ kind: 'idle', message: '' });

  const recommended = useMemo(
    () => chooseRecommendedAccount(dashboard.accounts, dashboard.settings?.strategy),
    [dashboard.accounts, dashboard.settings?.strategy]
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
      actionPendingRef.current = true;
      setBusy(true);
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
      } finally {
        if (!cancelled) {
          actionPendingRef.current = false;
          setBusy(false);
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

    let inFlight = false;
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      if (actionPendingRef.current || inFlight) return;
      inFlight = true;
      const version = actionVersionRef.current;
      void window.desktopApi.getDashboard().then((next) => {
        if (!cancelled && version === actionVersionRef.current) setDashboard(next);
      }).catch(() => {
        // Keep the last good state visible during a transient transition.
      }).finally(() => { inFlight = false; });
    }, 5000);

    return () => { cancelled = true; window.clearInterval(intervalId); };
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

  useEffect(() => {
    if(isDemoMode || !window.desktopApi.getFeatures) return;
    let current=true;
    const poll=()=>{void window.desktopApi.getFeatures().then(value=>{if(current)setFeatureState(value);}).catch(()=>{});};
    poll();const timer=window.setInterval(poll,1000);
    return()=>{current=false;window.clearInterval(timer);};
  },[isDemoMode]);

  function reloadDashboard(){
    if(!isDemoMode)void window.desktopApi.getDashboard().then(setDashboard).catch(()=>{});
  }

  const activeAccount = dashboard.accounts.find(
    (account) => account.id === dashboard.state.activeAccountId
  );

  async function runAction(action: () => Promise<DashboardPayload>, successMessage: string) {
    if (isDemoMode) {
      setStatus({
        kind: 'success',
        message: '공개 저장소용 데모 화면입니다. 실제 계정 정보는 사용하지 않습니다.'
      });
      return true;
    }
    if (actionPendingRef.current) return false;
    actionPendingRef.current = true;
    actionVersionRef.current += 1;
    setBusy(true);
    setStatus({ kind: 'idle', message: '' });

    try {
      const next = await action();
      setDashboard(next);
      setStatus({ kind: 'success', message: successMessage });
      return true;
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '예상하지 못한 오류가 발생했습니다.'
      });
      // A failed relaunch can still leave the authentication successfully switched.
      try { setDashboard(await window.desktopApi.getDashboard()); } catch { /* Preserve the error. */ }
      return false;
    } finally {
      actionPendingRef.current = false;
      setBusy(false);
    }
  }

  const bannerMessage = featureState?.progress ?? (busy ? '처리 중입니다. 잠시 기다려 주세요.' :
    status.kind === 'idle'
      ? isDemoMode
        ? '공개 저장소용 데모 화면입니다. 실제 계정 정보 없이 기능 예시만 표시합니다.'
        : getRegistrationHelpText(dashboard.state.registration)
      : status.message);

  return (
    <main className="app-shell" aria-busy={busy}>
      <fieldset className="dashboard-controls" disabled={busy}>
      <SummaryBar
        activeLabel={activeAccount?.label ?? '로그인 확인 필요'}
        recommendedLabel={recommended?.label ?? '추천 가능한 계정 없음'}
        recommendedDisabled={!recommended || recommended.id === activeAccount?.id}
        autoRestartOnSwitch={dashboard.state.autoRestartOnSwitch}
        onSwitchRecommended={() =>
          void runAction(
            () => window.desktopApi.switchRecommendedAccount(),
            dashboard.state.autoRestartOnSwitch
              ? '추천 계정으로 전환했습니다. ChatGPT를 자동으로 다시 여는 중입니다.'
              : '추천 계정으로 전환했습니다. ChatGPT/Codex를 직접 실행해 주세요.'
          )
        }
        onRefreshAll={() =>
          void runAction(
            () => window.desktopApi.refreshAll(),
            '모든 계정의 사용량을 다시 불러왔습니다.'
          )
        }
        onAutoRestartChange={(enabled) =>
          void runAction(
            () => window.desktopApi.setAutoRestartOnSwitch(enabled),
            enabled
              ? '계정 전환 시 ChatGPT/Codex를 자동으로 종료하고 다시 엽니다.'
              : '자동 종료 및 재시작을 껐습니다. 전환 전 빨간 종료 버튼을 먼저 눌러 주세요.'
          )
        }
        onTerminateCodex={() =>
          void runAction(
            () => window.desktopApi.terminateCodex(),
            'ChatGPT/Codex를 안전하게 종료했습니다.'
          )
        }
        onAddAccount={() => {setReauthId(undefined);setModalOpen(true);}}
      />

      <section className={`status-banner ${status.kind}`}>
        <strong>{status.kind === 'error' ? '오류' : '안내'}</strong>
        <span>{bannerMessage}</span>
      </section>

      <nav className="app-tabs" aria-label="보기 선택">
        <button className={tab==='accounts'?'selected':''} onClick={()=>setTab('accounts')}>계정</button>
        <button className={tab==='analytics'?'selected':''} onClick={()=>setTab('analytics')}>사용량 분석</button>
        <button className={tab==='tools'?'selected':''} onClick={()=>setTab('tools')}>설정과 진단</button>
      </nav>
      {tab==='analytics' && <AnalyticsPanel accounts={dashboard.accounts} demo={isDemoMode}/>}
      {tab==='tools' && <ToolsPanel demo={isDemoMode} onChanged={reloadDashboard}/>}
      {tab==='accounts' && <section className="card-grid">
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
            demo={isDemoMode}
            onChanged={reloadDashboard}
            onLogin={()=>{setReauthId(account.id);setModalOpen(true);}}
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
                dashboard.state.autoRestartOnSwitch
                  ? `${account.label} 계정으로 전환했습니다. ChatGPT를 자동으로 다시 여는 중입니다.`
                  : `${account.label} 계정으로 전환했습니다. ChatGPT/Codex를 직접 실행해 주세요.`
              )
            }
          />
        ))}
      </section>}

      <AddAccountModal
        open={modalOpen}
        key={reauthId??'add'}
        reauthLabel={dashboard.accounts.find(a=>a.id===reauthId)?.label}
        login={featureState?.login}
        onLogin={async(label)=>{
          if(isDemoMode)return;
          try { const login=await window.desktopApi.startLogin(label,reauthId);setFeatureState(s=>s?{...s,login}:s); }
          catch(error){setStatus({kind:'error',message:error instanceof Error?error.message:String(error)});}
        }}
        onCancelLogin={()=>{void window.desktopApi.cancelLogin().then(login=>setFeatureState(s=>s?{...s,login}:s));}}
        onClose={() => {
          setModalOpen(false);
          if(!isDemoMode && ['waiting','starting'].includes(featureState?.login.status??''))void window.desktopApi.cancelLogin();
          reloadDashboard();
        }}
        onCapture={async (label) => {
          const saved = await runAction(
            () => window.desktopApi.captureCurrentAuth({ label }),
            '현재 인증을 안전하게 저장했습니다. 이미 있던 계정이면 최신 토큰으로 갱신했습니다.'
          );
          if (saved) setModalOpen(false);
          return saved;
        }}
      />
      </fieldset>
    </main>
  );
}
