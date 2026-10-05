import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Content } from '@/components/frame/content';
import { AppText } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Scrolling page body with the footer at the end. Every screen renders inside one. */
export function Page({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.paper }]}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom }]}>
      <View role="main" style={styles.main}>
        {children}
      </View>
      <View role="contentinfo" style={[styles.footer, { borderTopColor: colors.line }]}>
        <Content style={styles.footerRow}>
          <AppText variant="small" tone="inkMuted">
            Cramrade. A study plan built from your exam dates and your own notes.
          </AppText>
        </Content>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
  },
  main: {
    flexGrow: 1,
  },
  footer: {
    borderTopWidth: 1,
  },
  footerRow: {
    paddingVertical: Spacing.lg,
  },
});
