import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/** A plain action button for the trial page only. Thrown away with the trial. */
export function TrialButton({ label, onPress, disabled }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      role="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.session, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}>
      <AppText tone="onSession" bold>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.control,
  },
});
