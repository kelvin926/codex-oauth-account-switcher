import { Icon } from '../../../shared/Icon';

type SummaryBarProps = {
  activeLabel: string;
  recommendedLabel: string;
  recommendedDisabled: boolean;
  autoRestartOnSwitch: boolean;
  onSwitchRecommended: () => void;
  onRefreshAll: () => void;
  onAutoRestartChange: (enabled: boolean) => void;
  onTerminateCodex: () => void;
  onAddAccount: () => void;
};

export function SummaryBar(props: SummaryBarProps) {
  return (
    <section className="summary-bar">
      <div className="summary-cell current-summary">
        <p className="eyebrow">현재 계정</p>
        <strong>{props.activeLabel}</strong>
      </div>
      <div className="summary-cell">
        <p className="eyebrow">추천 계정</p>
        <strong>{props.recommendedLabel}</strong>
      </div>
      <div className="summary-actions">
        <label className="auto-restart-toggle">
          <input
            type="checkbox"
            checked={props.autoRestartOnSwitch}
            onChange={(event) => props.onAutoRestartChange(event.currentTarget.checked)}
            aria-label="전환 시 자동 종료 및 재시작"
          />
          <span className="auto-restart-track" aria-hidden="true">
            <span className="auto-restart-thumb" />
          </span>
          <span className="auto-restart-copy">
            <strong>전환 시 자동 종료 및 재시작</strong>
            <small>
              {props.autoRestartOnSwitch
                ? '계정 전환 후 앱을 자동으로 다시 엽니다.'
                : '앱을 종료한 뒤 전환하고 직접 실행합니다.'}
            </small>
          </span>
        </label>
        <div className="summary-action-row">
          <button
            className="ghost-button"
            onClick={props.onSwitchRecommended}
            disabled={props.recommendedDisabled}
          >
            <Icon name="switch"/>추천으로 전환
          </button>
          <button className="secondary-button" onClick={props.onRefreshAll}>
            <Icon name="refresh"/>전체 갱신
          </button>
          <button className="danger-button" onClick={props.onTerminateCodex}>
            <Icon name="power"/>ChatGPT/Codex 종료
          </button>
          <button className="primary-button" onClick={props.onAddAccount}>
            <Icon name="plus"/>계정 추가
          </button>
        </div>
      </div>
    </section>
  );
}
