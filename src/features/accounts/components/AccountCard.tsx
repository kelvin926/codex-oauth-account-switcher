import { AccountExtras } from './AccountExtras';
import { Fragment } from 'react';
import { Icon } from '../../../shared/Icon';
import { formatWindowLabel, getUsageWindows } from '../../../core/usageWindows';
import { PLAN_LABELS } from '../../../shared/desktopApi';
import type { AccountRecord } from '../../../core/types';
import {
  formatCreditBalance,
  formatResetCredits,
  formatRemaining,
  formatResetTimestamp,
  formatTimestamp,
  getAccountBadge,
  getAccountScore
} from '../actions';
import type { DesktopState } from '../../../shared/desktopApi';

type AccountCardProps = {
  account: AccountRecord;
  state: DesktopState;
  recommendedId: string | null;
  onRefresh: () => void;
  onDelete: () => void;
  onSwitch: () => void;
  demo?: boolean;
  onChanged?: () => void;
  onLogin?: () => void;
};

export function AccountCard(props: AccountCardProps) {
  const { account } = props;
  const badge = getAccountBadge(account, props.state, props.recommendedId);
  const switchDisabled = account.canSwitch === false || props.state.activeAccountId === account.id;
  const windows = getUsageWindows(account.usage);

  return (
    <article className="account-card" data-active={props.state.activeAccountId===account.id} data-recommended={props.recommendedId===account.id}>
      <div className="card-header">
        <div className="account-identity">
          <span className="account-avatar" aria-hidden="true">{account.label.trim().slice(0,1)}</span>
          <div>
          <p className="eyebrow">{PLAN_LABELS[account.planType]}</p>
          <h3>{account.label}</h3>
          </div>
        </div>
        <span className="badge">{badge}</span>
      </div>
      <dl className="metric-grid">
        {windows.map((window) => (
          <Fragment key={window.key}>
            <div className="quota-metric">
              <dt>{formatWindowLabel(window.seconds, window.key)} 남은 양</dt>
              <dd>{formatRemaining(window.remaining)}</dd>
              <dd className="quota-meter"><progress aria-label={`${account.label} ${formatWindowLabel(window.seconds, window.key)} 남은 양`} max="100" value={Math.max(0,Math.min(100,window.remaining))} data-low={window.remaining<=20}/></dd>
            </div>
            <div className="reset-metric">
              <dt>{formatWindowLabel(window.seconds, window.key)} 초기화</dt>
              <dd className="metric-value-compact">{formatResetTimestamp(window.resetAt)}</dd>
            </div>
          </Fragment>
        ))}
        {windows.length === 0 ? (
          <div>
            <dt>사용량</dt>
            <dd className="metric-value-compact">
              {account.usage ? '표시할 한도 없음' : '확인 필요'}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>초기화권</dt>
          <dd className="metric-value-compact">{formatResetCredits(account.usage?.availableResetCredits)}</dd>
        </div>
        <div>
          <dt>남은 크레딧</dt>
          <dd className="metric-value-compact">{formatCreditBalance(account.usage?.credits)}</dd>
        </div>
        <div>
          <dt>추천 점수</dt>
          <dd>{getAccountScore(account)}</dd>
        </div>
        <div>
          <dt>마지막 확인</dt>
          <dd className="metric-value-compact">
            {formatTimestamp(account.usage?.fetchedAt ?? account.updatedAt)}
          </dd>
        </div>
      </dl>
      {account.usage?.allowed === false || account.usage?.limitReached ? (
        <p className="card-note">서버에서 사용 한도에 도달한 것으로 표시했습니다.</p>
      ) : null}
      {account.status === 'needs-refresh' ? (
        <p className="card-note">사용량을 다시 확인해 주세요. 이전 수치는 추천에 반영하지 않습니다.</p>
      ) : null}
      {account.switchBlockedReason ? (
        <p className="card-note">{account.switchBlockedReason}</p>
      ) : null}
      {account.excluded && <p className="card-note">추천에서 제외된 계정입니다. 수동 전환은 가능합니다.</p>}
      <div className="card-actions">
        <button className="secondary-button" onClick={props.onRefresh}>
          <Icon name="refresh"/>갱신
        </button>
        <button className="ghost-button" onClick={props.onDelete}>
          삭제
        </button>
        <button
          className="primary-button"
          onClick={props.onSwitch}
          disabled={switchDisabled}
          title={account.switchBlockedReason ?? undefined}
        >
          이 계정으로 전환
        </button>
      </div>
      {props.onChanged && props.onLogin && <AccountExtras account={account} demo={props.demo??false} onChanged={props.onChanged} onLogin={props.onLogin}/>}
    </article>
  );
}
