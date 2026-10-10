import { Placeholder } from '@/components/frame/placeholder';
import { useAuth } from '@/features/auth/auth-provider';
import { NotesScreen } from '@/features/notes/notes-screen';

export default function NotesRoute() {
  const { session, loading } = useAuth();
  if (loading) return <Placeholder title="Your notes" text="Checking whether you are signed in." />;
  if (!session || session.user.is_anonymous)
    return (
      <Placeholder
        title="Your notes"
        text="Sign in to upload your notes."
        link={{ href: '/sign-in', label: 'Sign in' }}
      />
    );
  return <NotesScreen key={session.user.id} ownerId={session.user.id} />;
}
