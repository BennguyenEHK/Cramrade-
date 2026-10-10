import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  children: string;
  onPress: () => void;
  variant?: 'primary' | 'quiet';
  /** Shows `busyLabel` and ignores presses, for example while a request runs. */
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** A button that does something on this screen. For moving to another screen use LinkButton. */
export function Button({
  children,
  onPress,
  variant = 'primary',
  busy = false,
  busyLabel,
  disabled = false,
  selected,
  style,
}: Props) {
  const { colors } = useTheme();
  const inactive = busy || disabled;

  return (
    <Pressable
      role="button"
      aria-disabled={inactive}
      aria-pressed={selected}
      aria-busy={busy}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary'
          ? { backgroundColor: colors.session }
          : { borderWidth: 1.5, borderColor: colors.line },
        { opacity: inactive ? 0.6 : pressed ? 0.85 : 1 },
        style,
      ]}>
      <AppText tone={variant === 'primary' ? 'onSession' : 'ink'} bold style={styles.label}>
        {busy && busyLabel ? busyLabel : children}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
