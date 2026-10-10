import { EXAM_KINDS, type ExamKind, type Note } from '@cramrade/shared';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WorkspacePage, workspaceStyles as s } from '@/components/frame/workspace-page';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { DatePicker } from '@/features/exams/date-picker';
import { parseDate } from '@/features/exams/dates';
import { listNotes } from '@/lib/note-data';
import { errorMessage, invoke } from '@/lib/functions';
import { supabase } from '@/lib/supabase';

type Proposal = {
  title: string;
  date: string;
  kind: ExamKind;
  topics: string[];
  evidence: string;
  past: boolean;
};
type Draft = Proposal & {
  id: string;
  topicIds: string[];
  topicsText: string;
  saved: boolean;
  examSaved: boolean;
};

export function SyllabusScreen({ ownerId }: { ownerId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    listNotes(ownerId)
      .then((rows) => {
        if (alive) setNotes(rows.filter((n) => n.isSyllabus));
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ownerId]);
  async function readSyllabus(noteId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setRead(false);
    setDrafts([]);
    try {
      const result = await invoke<{ proposals: Proposal[] }>('read-syllabus', { noteId });
      setDrafts(
        result.proposals.map((p) => ({
          ...p,
          id: randomUUID(),
          topicIds: p.topics.map(() => randomUUID()),
          topicsText: p.topics.join('\n'),
          saved: false,
          examSaved: false,
        })),
      );
      setRead(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function edit(id: string, patch: Partial<Draft>) {
    setDrafts((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  async function confirm(draft: Draft) {
    if (lock.current) return;
    const topics = [
      ...new Set(
        draft.topicsText
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !draft.title.trim() ||
      draft.title.trim().length > 120 ||
      !parseDate(draft.date) ||
      topics.length > 30 ||
      topics.some((t) => t.length > 120)
    ) {
      setError('Enter a name, a real date, and up to 30 topics of at most 120 characters each.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      // Stable ids make retries safe when a connection drops after saving.
      const { error: examError } = await supabase.from('exams').upsert({
        id: draft.id,
        owner_id: ownerId,
        title: draft.title.trim(),
        exam_date: draft.date,
        kind: draft.kind,
        source: 'syllabus',
      });
      if (examError) throw examError;
      edit(draft.id, { examSaved: true });
      const ids = topics.map((_, i) => draft.topicIds[i] ?? randomUUID());
      edit(draft.id, { topicIds: ids });
      if (topics.length) {
        const { error: topicError } = await supabase
          .from('topics')
          .upsert(
            topics.map((title, i) => ({ id: ids[i], exam_id: draft.id, title, position: i })),
          );
        if (topicError)
          throw new Error(
            `The exam was saved, but its topics were not: ${topicError.message}. Press Confirm again to retry.`,
          );
      }
      edit(draft.id, { saved: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <WorkspacePage
      title="Confirm syllabus dates"
      intro="Check the dates and topics found in your syllabus. Each exam is saved only when you confirm it."
    >
      <AppText>
        Your syllabus text is sent to AI to find dates. Check every suggestion against the original.
      </AppText>
      <LinkButton href="/notes">Upload a syllabus</LinkButton>
      <AppText variant="small">
        On Notes, choose “File purpose: syllabus”, upload, then return here.
      </AppText>
      {error !== '' && <AppText role="alert">{error}</AppText>}
      {loading ? (
        <AppText>Loading your syllabuses…</AppText>
      ) : notes.length === 0 && !error ? (
        <AppText>No syllabuses uploaded yet.</AppText>
      ) : null}
      {notes.map((note) => (
        <View key={note.id} style={s.panel}>
          <AppText bold>{note.title}</AppText>
          <Button
            disabled={busy || note.status !== 'ready'}
            onPress={() => void readSyllabus(note.id)}
          >
            Find dates
          </Button>
          <AppText variant="small">
            {note.status === 'ready' ? 'Ready to read' : note.failureReason || note.status}
          </AppText>
        </View>
      ))}
      {busy && <AppText accessibilityLiveRegion="polite">Working… Keep this page open.</AppText>}
      {read && drafts.length === 0 && (
        <View style={s.stack}>
          <AppText>No dates found. You can enter your exam dates yourself.</AppText>
          <LinkButton href="/workspace">Enter exam dates</LinkButton>
        </View>
      )}
      {drafts.map((draft) => (
        <View key={draft.id} style={s.panel}>
          {draft.saved ? (
            <>
              <AppText bold>{draft.title} saved with its topics.</AppText>
              <LinkButton href="/workspace" variant="quiet">
                View exams
              </LinkButton>
            </>
          ) : (
            <>
              <AppText selectable tone="inkMuted">
                From your syllabus: “{draft.evidence}”
              </AppText>
              {draft.past && <AppText>This suggested date is in the past. Check the year.</AppText>}
              <TextField
                label="Exam name"
                value={draft.title}
                editable={!busy && !draft.examSaved}
                maxLength={120}
                onChangeText={(title) => edit(draft.id, { title })}
              />
              <DatePicker
                value={draft.date}
                onChange={(date) => edit(draft.id, { date })}
                disabled={busy || draft.examSaved}
              />
              <View style={s.actions}>
                {EXAM_KINDS.map((kind) => (
                  <Button
                    key={kind}
                    disabled={busy || draft.examSaved}
                    variant={draft.kind === kind ? 'primary' : 'quiet'}
                    onPress={() => edit(draft.id, { kind })}
                  >
                    {kind}
                  </Button>
                ))}
              </View>
              <TextField
                label="Topics (one per line)"
                multiline
                value={draft.topicsText}
                editable={!busy && !draft.examSaved}
                onChangeText={(topicsText) => edit(draft.id, { topicsText })}
              />
              <View style={s.actions}>
                <Button disabled={busy} onPress={() => void confirm(draft)}>
                  Confirm exam and topics
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy || draft.examSaved}
                  onPress={() => setDrafts((rows) => rows.filter((r) => r.id !== draft.id))}
                >
                  Discard suggestion
                </Button>
              </View>
            </>
          )}
        </View>
      ))}
    </WorkspacePage>
  );
}
