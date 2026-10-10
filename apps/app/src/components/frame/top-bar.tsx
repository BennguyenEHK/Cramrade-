import { Link, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Content } from '@/components/frame/content';
import { Wordmark } from '@/components/frame/wordmark';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

function navItems(signedIn: boolean): { href: Href; label: string }[] {
  return [
    { href: '/', label: 'Home' },
    { href: '/workspace', label: 'Workspace' },
    // One page shows the form when signed out and the account when signed in.
    { href: '/sign-in', label: signedIn ? 'Account' : 'Sign in' },
  ];
}

/**
 * The frame's top bar: wordmark on the left, the three main links on the right.
 * The last link reads "Account" once the student is signed in.
 * Children of `Link asChild` get one flat style object (see LinkButton).
 */
export function TopBar() {
  const { colors } = useTheme();
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { session } = useAuth();

  return (
    <View
      role="navigation"
      style={[
        styles.bar,
        { paddingTop: insets.top, backgroundColor: colors.paper, borderBottomColor: colors.line },
      ]}>
      <Content style={[styles.row, { height: Layout.topBarHeight }]}>
        <Link href="/" asChild>
          <Pressable role="link" aria-label="Cramrade home" style={styles.home}>
            <Wordmark size={wide ? 24 : 20} />
          </Pressable>
        </Link>

        <View style={[styles.links, { gap: wide ? Spacing.lg : Spacing.md }]}>
          {navItems(session !== null).map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={String(item.href)} href={item.href} asChild>
                <Pressable
                  role="link"
                  aria-current={active ? 'page' : undefined}
                  style={styles.link}>
                  <AppText
                    variant={wide ? 'body' : 'small'}
                    tone={active ? 'ink' : 'inkMuted'}
                    bold={active}>
                    {item.label}
                  </AppText>
                  <View
                    style={[
                      styles.underline,
                      { backgroundColor: active ? colors.session : 'transparent' },
                    ]}
                  />
                </Pressable>
              </Link>
            );
          })}
        </View>
      </Content>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  home: {
    paddingVertical: Spacing.xs,
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  underline: {
    height: 2,
    alignSelf: 'stretch',
    marginTop: 2,
    borderRadius: 1,
  },
});
