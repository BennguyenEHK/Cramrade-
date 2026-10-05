import { useWindowDimensions } from 'react-native';

import { Layout } from '@/constants/theme';

/**
 * Phone or wide layout, from the window width.
 * During static rendering the width is 0, so pages render the phone layout first
 * and switch on the client. Keep both layouts readable.
 */
export function useLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= Layout.wideBreakpoint;
  return {
    wide,
    gutter: wide ? Layout.gutterWide : Layout.gutterNarrow,
  };
}
