import { useLocalSearchParams } from 'expo-router';
import { MemberScreen } from '@/components/frame/workspace-page';
import { StudyScreen } from '@/features/study/study-screen';
export default function Screen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  return (
    <MemberScreen title="Study">
      {(ownerId) => (
        <StudyScreen
          key={`${ownerId}:${sessionId ?? 'review'}`}
          ownerId={ownerId}
          sessionId={sessionId}
        />
      )}
    </MemberScreen>
  );
}
