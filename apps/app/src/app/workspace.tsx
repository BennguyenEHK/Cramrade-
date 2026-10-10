import { Placeholder } from '@/components/frame/placeholder';
import { useAuth } from '@/features/auth/auth-provider';
import { ExamsScreen } from '@/features/exams/exams-screen';

export default function WorkspaceScreen() {
  const { session, loading } = useAuth();
  if (loading) return <Placeholder title="Workspace" text="Checking whether you are signed in." />;
  if (!session || session.user.is_anonymous) return <Placeholder title="Workspace"
    text="Sign in to save your exams and notes." link={{ href: '/sign-in', label: 'Sign in' }} />;
  return <ExamsScreen key={session.user.id} ownerId={session.user.id} />;
}
