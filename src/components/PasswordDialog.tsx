import { useState } from 'react';
import { changeOwnPassword } from '../lib/adminUsers';
import { useEditorStore } from '../store/useEditorStore';
import { Modal } from './Modal';

/** Anyone can change their own password — needed after an admin issues one. */
export function PasswordDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Matches the minimum enforced on the server, so a rejection is not the
  // first time the user hears about the rule.
  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = repeat.length > 0 && password !== repeat;
  const canSave = password.length >= 12 && password === repeat && !busy;

  async function onSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await changeOwnPassword(password);
      setToast('პაროლი შეიცვალა');
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="პაროლის შეცვლა"
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          <button className="btn primary" disabled={!canSave} onClick={() => void onSave()}>
            {busy ? '…' : 'შენახვა'}
          </button>
        </>
      }
    >
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span>ახალი პაროლი</span>
        <input
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="field">
        <span>გაიმეორე</span>
        <input
          type="password"
          value={repeat}
          autoComplete="new-password"
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>

      <p className="field-hint">
        {tooShort
          ? 'მინიმუმ 12 სიმბოლო.'
          : mismatch
            ? 'პაროლები არ ემთხვევა.'
            : 'მინიმუმ 12 სიმბოლო.'}
      </p>
    </Modal>
  );
}
