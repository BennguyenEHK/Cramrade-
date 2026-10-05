import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'ink' | 'quiet';

type Props = {
  href: Href;
  children: string;
  variant?: Variant;
  size?: 'regular' | 'large';
  style?: StyleProp<ViewStyle>;
};

/**
 * A button that navigates. Renders a real link on web so it works with the
 * keyboard, middle click and the browser's back button.
 *
 * The child of `Link asChild` must get one flat style object: Link merges
 * styles with an object spread, so arrays throw and functions are dropped.
 */
export function LinkButton({ href, children, variant = 'primary', size = 'regular', style }: Props) {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);

  const fill: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: colors.session }
      : variant === 'ink'
        ? { backgroundColor: colors.ink }
        : { borderWidth: 1.5, borderColor: colors.line };

  const tone = variant === 'primary' ? 'onSession' : variant === 'ink' ? 'onInk' : 'ink';

  const flat = StyleSheet.flatten([
    styles.base,
    size === 'large' && styles.large,
    fill,
    pressed && styles.pressed,
    style,
  ]);

  return (
    <Link href={href} asChild>
      <Pressable
        role="link"
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={flat}>
        <AppText variant={size === 'large' ? 'lead' : 'body'} tone={tone} bold style={styles.label}>
          {children}
        </AppText>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    textAlign: 'center',
  },
});
