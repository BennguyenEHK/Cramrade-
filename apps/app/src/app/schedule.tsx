import { MemberScreen } from '@/components/frame/workspace-page';
import { ScheduleScreen } from '@/features/schedule/schedule-screen';
export default function Screen() {
  return (
    <MemberScreen title="Schedule">
      {(ownerId) => <ScheduleScreen ownerId={ownerId} />}
    </MemberScreen>
  );
}
