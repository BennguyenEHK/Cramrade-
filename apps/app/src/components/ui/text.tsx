import { StyleSheet, Text, type TextProps } from 'react-native';

import { type ColorName, Fonts, FontSize, LineHeight } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

export type TextVariant = 'display' | 'headline' | 'title' | 'lead' | 'body' | 'small';

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  /** A color name from the theme. Defaults to ink. */
  tone?: ColorName;
  /** Body and small text only: use the bold cut. */
  bold?: boolean;
};

/**
 * The one text component. Headlines use Bricolage Grotesque, everything else
 * Atkinson Hyperlegible. Each weight is its own font family (Expo SDK 57),
 * so this never sets fontWeight.
 */
export function AppText({ variant = 'body', tone = 'ink', bold, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const { wide } = useLayout();

  const role = variant === 'display' || variant === 'headline' ? 'heading' : undefined;

  return (
    <Text
      role={role}
      aria-level={variant === 'display' ? 1 : variant === 'headline' ? 2 : undefined}
      style={[
        { color: colors[tone] },
        variant === 'display' && (wide ? styles.displayWide : styles.displayNarrow),
        variant === 'headline' && (wide ? styles.headlineWide : styles.headlineNarrow),
        variant === 'title' && styles.title,
        variant === 'lead' && styles.lead,
        variant === 'body' && (bold ? styles.bodyBold : styles.body),
        variant === 'small' && (bold ? styles.smallBold : styles.small),
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  displayNarrow: {
    fontFamily: Fonts.displayHeavy,
    fontSize: FontSize.displayNarrow,
    lineHeight: Math.round(FontSize.displayNarrow * 1.02),
    letterSpacing: -0.02 * FontSize.displayNarrow,
  },
  displayWide: {
    fontFamily: Fonts.displayHeavy,
    fontSize: FontSize.displayWide,
    lineHeight: Math.round(FontSize.displayWide * 1.02),
    letterSpacing: -0.02 * FontSize.displayWide,
  },
  headlineNarrow: {
    fontFamily: Fonts.display,
    fontSize: FontSize.headlineNarrow,
    lineHeight: Math.round(FontSize.headlineNarrow * 1.1),
    letterSpacing: -0.01 * FontSize.headlineNarrow,
  },
  headlineWide: {
    fontFamily: Fonts.display,
    fontSize: FontSize.headlineWide,
    lineHeight: Math.round(FontSize.headlineWide * 1.1),
    letterSpacing: -0.015 * FontSize.headlineWide,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
  },
  lead: {
    fontFamily: Fonts.body,
    fontSize: FontSize.lead,
    lineHeight: LineHeight.lead,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  bodyBold: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  small: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    lineHeight: LineHeight.small,
  },
  smallBold: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.small,
    lineHeight: LineHeight.small,
  },
});
