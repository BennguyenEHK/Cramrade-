import { EXAM_KINDS, type Exam, type ExamKind } from '@cramrade/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Page } from '@/components/frame/page';
import { PageHead } from '@/components/frame/page-head';
import { Section } from '@/components/frame/section';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { deleteExam, listExams, saveExam } from '@/lib/exam-data';
import { rebuildPlan } from '@/lib/plan-data';
import { WorkspaceLinks } from '@/components/frame/workspace-page';
import { DatePicker } from './date-picker';
import { dateOnly, formatDate, parseDate } from './dates';

const labels: Record<ExamKind, string> = { exam: 'Exam', quiz: 'Quiz', competition: 'Competition' };

export function ExamsScreen({ ownerId }: { ownerId: string }) {
  const { colors } = useTheme();
  const { wide } = useLayout();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<ExamKind>('exam');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try { const result = await listExams(ownerId); if (request.current === version) setExams(result); }
    catch { if (request.current === version) setError('Could not load your exams. Check your connection and refresh.'); }
    finally { if (request.current === version) setLoading(false); }
  }, [ownerId]);
  useEffect(() => {
    let active = true;
    listExams(ownerId).then(result => { if (active) setExams(result); })
      .catch(() => { if (active) setError('Could not load your exams. Check your connection and refresh.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId]);
  function resetForm() { setEditing(null); setTitle(''); setDate(''); setKind('exam'); }
  async function save() {
    if (lock.current) return;
    setError(''); setMessage('');
    if (!title.trim() || title.trim().length > 120) { setError('Enter an exam name between 1 and 120 characters.'); return; }
    if (!parseDate(date)) { setError('Choose a real date between 1900 and 2100, written as YYYY-MM-DD.'); return; }
    lock.current = true; setBusy(true);
    try {
      const saved = await saveExam(ownerId, { title, examDate: date, kind }, editing?.id);
      setExams(current => [...current.filter(exam => exam.id !== saved.id), saved].sort((a, b) => a.examDate.localeCompare(b.examDate)));
      setMessage(editing ? 'Exam updated.' : 'Exam added.'); resetForm();
      await rebuildPlan().catch(() => setMessage('Exam saved. The plan could not rebuild. Open Schedule and choose Rebuild plan to retry.'));
    } catch { setError('Could not save your exam. Your changes are still here. Check your connection and try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove(exam: Exam) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await deleteExam(ownerId, exam.id);
      setExams(current => current.filter(item => item.id !== exam.id));
      if (editing?.id === exam.id) resetForm();
      setDeleting(null); setMessage('Exam deleted.');
    } catch { setError('Could not delete the exam. Check your connection and try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Page><PageHead title="Your exams" /><Section style={styles.section}>
    <View style={styles.heading}><AppText variant="headline">Your exams</AppText><AppText tone="inkMuted">Start with the date you’re working toward. Your exams are saved to your account.</AppText></View>
    <WorkspaceLinks />
    {!!error && <AppText role="alert">{error}</AppText>}
    {!!message && <AppText accessibilityLiveRegion="polite">{message}</AppText>}
    <View style={[styles.columns, wide && styles.wide]}>
      <View style={styles.list}>
        <View style={styles.row}><AppText variant="title">Exam dates</AppText><Button variant="quiet" disabled={busy || loading} onPress={() => void refresh()}>Refresh</Button></View>
        {loading ? <AppText tone="inkMuted">Loading your exams…</AppText> : exams.length === 0 ?
          <View style={[styles.empty, { borderColor: colors.line }]}><AppText variant="title">What’s coming up?</AppText><AppText tone="inkMuted">Add your first exam, quiz or competition using the form.</AppText></View> :
          exams.map(exam => <View key={exam.id} style={[styles.exam, { borderColor: colors.line }]}>
            <AppText bold tone="exam">{formatDate(exam.examDate)}{exam.examDate < dateOnly(new Date()) ? ' (past)' : ''}</AppText>
            <AppText variant="title">{exam.title}</AppText><AppText tone="inkMuted" variant="small">{labels[exam.kind]}</AppText>
            {deleting === exam.id ? <View style={styles.heading}>
              <AppText>Delete “{exam.title}”? Its topics and scheduled study sessions will also be removed. This cannot be undone.</AppText>
              <View style={styles.actions}><Button busy={busy} busyLabel="Deleting…" onPress={() => void remove(exam)}>Confirm delete</Button><Button variant="quiet" disabled={busy} onPress={() => setDeleting(null)}>Keep exam</Button></View>
            </View> : <View style={styles.actions}>
              <Button variant="quiet" disabled={busy || loading} onPress={() => { setEditing(exam); setTitle(exam.title); setDate(exam.examDate); setKind(exam.kind); setDeleting(null); setError(''); setMessage(''); }}>Edit</Button>
              <Button variant="quiet" disabled={busy || loading} onPress={() => setDeleting(exam.id)}>Delete</Button>
            </View>}
          </View>)}
      </View>
      <View style={[styles.form, wide && styles.formWide, { borderColor: colors.line, backgroundColor: colors.surface }]}>
        <AppText variant="title">{editing ? 'Edit exam' : 'Add an exam'}</AppText>
        <TextField label="Exam name" placeholder="e.g. Biology midterm" value={title} onChangeText={setTitle} maxLength={120} editable={!busy} />
        <View style={styles.heading}><AppText bold>Type</AppText><View style={styles.actions}>
          {EXAM_KINDS.map(value => <Pressable key={value} role="button" aria-pressed={kind === value} disabled={busy} onPress={() => setKind(value)} style={[styles.kind, { borderColor: colors.line, backgroundColor: kind === value ? colors.sessionSoft : colors.surface }]}><AppText bold={kind === value}>{labels[value]}</AppText></Pressable>)}
        </View></View>
        <DatePicker key={editing?.id ?? 'new'} value={date} onChange={setDate} disabled={busy} />
        <View style={styles.actions}><Button busy={busy} disabled={loading} busyLabel="Saving…" onPress={() => void save()}>{editing ? 'Save changes' : 'Add exam'}</Button>{editing && <Button variant="quiet" disabled={busy} onPress={resetForm}>Cancel editing</Button>}</View>
      </View>
    </View>
  </Section></Page>;
}
const styles = StyleSheet.create({
  section: { gap: Spacing.lg }, heading: { gap: Spacing.xs }, columns: { gap: Spacing.xl }, wide: { flexDirection: 'row', alignItems: 'flex-start' },
  list: { flex: 1, gap: Spacing.md, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  form: { padding: Spacing.lg, gap: Spacing.lg, borderWidth: 1, borderRadius: Radius.panel }, formWide: { width: '42%' },
  exam: { paddingVertical: Spacing.lg, gap: Spacing.sm, borderTopWidth: 1 }, empty: { paddingVertical: Spacing.xl, gap: Spacing.sm, borderTopWidth: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }, kind: { padding: Spacing.sm, borderWidth: 1, borderRadius: Radius.control },
});
