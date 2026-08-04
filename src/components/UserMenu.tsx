import { useAuthStore, type Role } from '../store/useAuthStore';
import { useEditorStore } from '../store/useEditorStore';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'ადმინისტრატორი',
  editor: 'რედაქტორი',
  // Names the permission, not a job title. "დამკვირვებელი" reads as a
  // supervisor in a work context — the opposite of what this role can do.
  viewer: 'მხოლოდ ნახვა',
};

/**
 * Who is signed in, and the way out. Renders nothing when the app is running
 * on the offline localStorage path, where there is no account to show.
 */
export function UserMenu() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const openDialog = useEditorStore((s) => s.openDialog);

  if (status !== 'signed-in' || !profile) return null;

  const name = profile.full_name.trim() || profile.email;

  return (
    <div className="user-menu">
      <span className="user-name" title={profile.email}>
        {name}
      </span>
      <span className={`user-role role-${profile.role}`}>{ROLE_LABEL[profile.role]}</span>
      {profile.role === 'admin' && (
        <button
          className="btn small"
          onClick={() => openDialog({ kind: 'users' })}
          title="მომხმარებლების მართვა"
        >
          👥 გუნდი
        </button>
      )}
      <button
        className="btn small"
        onClick={() => openDialog({ kind: 'password' })}
        title="პაროლის შეცვლა"
      >
        პაროლი
      </button>
      <button className="btn small" onClick={() => void signOut()} title="ანგარიშიდან გამოსვლა">
        გამოსვლა
      </button>
    </div>
  );
}
