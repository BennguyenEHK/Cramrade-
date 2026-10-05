import { StyleSheet, View, type ViewProps } from 'react-native';

import { Content } from '@/components/frame/content';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

type Props = ViewProps & {
  /** Fill the full width with the ink color (used once, for the closing block). */
  ink?: boolean;
  /** Draw a hairline above the section. */
  rule?: boolean;
};

/** A page section: vertical rhythm and the content column. */
export function Section({ ink, rule, style, children, ...rest }: Props) {
  const { colors } = useTheme();
  const { wide } = useLayout();
  const padding = wide ? Spacing.sectionWide : Spacing.section;

  return (
    <View
      style={[
        ink && { backgroundColor: colors.ink },
        rule && { borderTopWidth: 1, borderTopColor: colors.line },
      ]}
      {...rest}>
      <Content style={[{ paddingVertical: padding }, style]}>{children}</Content>
    </View>
  );
}

export const sectionStyles = StyleSheet.create({
  heading: {
    marginBottom: Spacing.xl,
  },
});
