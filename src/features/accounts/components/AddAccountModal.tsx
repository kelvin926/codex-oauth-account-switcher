import { useState } from 'react';

type AddAccountModalProps = {
  open: boolean;
  onClose: () => void;
  onCapture: (label: string) => Promise<void>;
};

export function AddAccountModal(props: AddAccountModalProps) {
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);

  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-panel">
        <div className="modal-header">
          <div>
            <p className="eyebrow">계정 등록</p>
            <h2>새 계정 추가</h2>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            닫기
          </button>
        </div>
        <label className="field">
          <span>계정 이름</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="예: 메인, 백업, 팀 계정"
          />
        </label>
        <div className="modal-copy">
          <p>현재 ChatGPT/Codex에 로그인된 계정의 최신 인증만 암호화해 저장합니다.</p>
          <p>이미 등록된 계정이면 중복 오류 없이 최신 토큰과 입력한 이름으로 갱신합니다.</p>
          <p>채팅, 프로젝트, 플러그인, 설정 파일은 복사하거나 변경하지 않습니다.</p>
        </div>
        <div className="modal-actions">
          <button
            className="primary-button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await props.onCapture(label);
                setLabel('');
              } finally {
                setPending(false);
              }
            }}
          >
            현재 계정 저장 또는 갱신
          </button>
        </div>
      </section>
    </div>
  );
}
