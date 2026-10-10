import { useLocalSearchParams } from 'expo-router';
import { QuizScreen } from '@/features/quiz/quiz-screen';
export default function Screen() {
  const { roomId, code } = useLocalSearchParams<{ roomId?: string; code?: string }>();
  return <QuizScreen key={`${roomId ?? 'join'}:${code ?? ''}`} roomId={roomId} joinCode={code} />;
}
