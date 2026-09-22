import { StyleSheet, View } from 'react-native';

import { palette, themed } from '@/theme';

/** The Hootly mark: night square with a lime dot. */
export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <View
      accessibilityLabel="Hootly"
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2.9 }]}
    >
      <View style={{ width: size / 3, height: size / 3, borderRadius: size / 6, backgroundColor: palette.lime }} />
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    mark: { backgroundColor: palette.night, alignItems: 'center', justifyContent: 'center' },
  })
);
