import { Placeholder } from '@/components/frame/placeholder';
import { useAuth } from '@/features/auth/auth-provider';

/**
 * PLACEHOLDER. Dev B replaces this with the real workspace (exams, notes,
 * schedule, study) in tasks B3 to B7. Only the route name should stay.
 * Since B2 it already asks signed-out students to sign in.
 */
export default function WorkspaceScreen() {
  const { session, loading } = useAuth();

  if (loading) {
    return <Placeholder title="Workspace" text="Checking whether you are signed in." />;
  }

  if (!session) {
    return (
      <Placeholder
        title="Workspace"
        text="Sign in to see your exams, notes and study plan."
        link={{ href: '/sign-in', label: 'Sign in' }}
      />
    );
  }

  return (
    <Placeholder
      title="Workspace"
      text={`Signed in as ${session.user.email ?? 'you'}. This is where your exams, notes and study plan will live. It is not built yet.`}
    />
  );
}
