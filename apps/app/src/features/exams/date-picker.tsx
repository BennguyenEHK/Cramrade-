import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateOnly, formatDate, parseDate } from './dates';

export function DatePicker({ value, onChange, disabled, label = 'Exam date' }: { value: string; onChange: (value: string) => void; disabled: boolean; label?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseDate(value) ?? new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return <View style={styles.field}>
    <TextField label={label} hint="YYYY-MM-DD, or choose a day below." value={value} onChangeText={onChange} editable={!disabled} maxLength={10} autoCapitalize="none" />
    <Button variant="quiet" disabled={disabled} onPress={() => { setMonth(parseDate(value) ?? new Date()); setOpen(!open); }}>{open ? 'Close calendar' : 'Choose a date'}</Button>
    {open && <View style={[styles.calendar, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <AppText bold>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</AppText>
      <View style={styles.controls}>
        <Button variant="quiet" disabled={disabled || (month.getFullYear() === 1900 && month.getMonth() === 0)} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}>Previous month</Button>
        <Button variant="quiet" disabled={disabled || (month.getFullYear() === 2100 && month.getMonth() === 11)} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}>Next month</Button>
      </View>
      <View style={styles.grid}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <View key={day} style={styles.day}><AppText variant="small" tone="inkMuted">{day}</AppText></View>)}
        {Array.from({ length: first.getDay() }, (_, index) => <View key={`blank-${index}`} style={styles.day} />)}
        {Array.from({ length: count }, (_, index) => {
          const date = dateOnly(new Date(month.getFullYear(), month.getMonth(), index + 1, 12));
          return <Pressable key={date} role="button" aria-label={formatDate(date)} aria-pressed={value === date} disabled={disabled}
            onPress={() => { onChange(date); setOpen(false); }} style={[styles.day, { borderRadius: Radius.control, backgroundColor: value === date ? colors.sessionSoft : colors.surface }]}>
            <AppText bold={value === date}>{index + 1}</AppText></Pressable>;
        })}
      </View>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  field: { gap: Spacing.sm }, calendar: { padding: Spacing.sm, gap: Spacing.sm, borderWidth: 1, borderRadius: Radius.panel },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }, grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.285714%', minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
