import { Colors, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** The current color scheme and its tokens. Every component reads colors through this. */
export function useTheme() {
  const raw = useColorScheme();
  const scheme: ColorScheme = raw === 'dark' ? 'dark' : 'light';
  return { scheme, colors: Colors[scheme] };
}
