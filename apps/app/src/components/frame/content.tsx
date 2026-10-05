import { StyleSheet, View, type ViewProps } from 'react-native';

import { Layout } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';

/** The content column: capped width, side gutters, left aligned. */
export function Content({ style, ...rest }: ViewProps) {
  const { gutter } = useLayout();
  return <View style={[styles.column, { paddingHorizontal: gutter }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
  },
});
