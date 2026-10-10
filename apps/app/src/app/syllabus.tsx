import { MemberScreen } from '@/components/frame/workspace-page';
import { SyllabusScreen } from '@/features/syllabus/syllabus-screen';
export default function Screen() {
  return (
    <MemberScreen title="Syllabus">
      {(ownerId) => <SyllabusScreen ownerId={ownerId} />}
    </MemberScreen>
  );
}
