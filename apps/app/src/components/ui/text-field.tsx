import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = TextInputProps & {
  label: string;
  /** A short line under the label, for example what the field is for. */
  hint?: string;
};

/** A labelled one-line text input in the app's style. */
export function TextField({ label, hint, style, onFocus, onBlur, ...rest }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <AppText bold>{label}</AppText>
      {hint ? (
        <AppText variant="small" tone="inkMuted">
          {hint}
        </AppText>
      ) : null}
      <TextInput
        aria-label={label}
        placeholderTextColor={colors.inkMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            color: colors.ink,
            backgroundColor: colors.surface,
            borderColor: focused ? colors.session : colors.line,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.xxs,
  },
  input: {
    marginTop: Spacing.xxs,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1.5,
    borderRadius: Radius.control,
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
  },
});
