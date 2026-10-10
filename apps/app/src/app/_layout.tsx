import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/frame/top-bar';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

/**
 * The app shell: fonts, color scheme, sign-in state, the top bar, and the screen below it.
 * Screens live in this folder and stay thin.
 */
export default function RootLayout() {
  const { scheme, colors } = useTheme();

  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.session,
      background: colors.paper,
      card: colors.surface,
      text: colors.ink,
      border: colors.line,
    },
  };

  return (
    <AuthProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <View style={[styles.shell, { backgroundColor: colors.paper }]}>
          <TopBar />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.paper },
              animation: 'fade',
            }}>
            <Stack.Screen name="index" options={{ title: 'Cramrade' }} />
            <Stack.Screen name="workspace" options={{ title: 'Workspace' }} />
            <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
          </Stack>
        </View>
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
