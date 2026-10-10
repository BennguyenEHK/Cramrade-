import { MemberScreen } from '@/components/frame/workspace-page';
import { SettingsScreen } from '@/features/settings/settings-screen';
export default function Screen() {
  return (
    <MemberScreen title="Study settings">
      {(ownerId) => <SettingsScreen ownerId={ownerId} />}
    </MemberScreen>
  );
}
