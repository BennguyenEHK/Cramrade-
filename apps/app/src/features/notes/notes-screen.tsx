import type { Chunk, Exam, Note } from '@cramrade/shared';
import * as DocumentPicker from 'expo-document-picker';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Page } from '@/components/frame/page';
import { PageHead } from '@/components/frame/page-head';
import { Section } from '@/components/frame/section';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listNotes, readChunks } from '@/lib/note-data';
import { listExams } from '@/lib/exam-data';
import { releaseFile } from './picked-file';
import { MAX_UPLOAD_BYTES, uploadNotes } from './upload';
import { WorkspaceLinks } from '@/components/frame/workspace-page';

type Selection = { asset: DocumentPicker.DocumentPickerAsset; id: string };
type Preview = { id: string; chunks: Chunk[]; loading: boolean; error: string };

export function NotesScreen({ ownerId }: { ownerId: string }) {
  const { colors } = useTheme();
  const [notes, setNotes] = useState<Note[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState<string | null>(null);
  const [isSyllabus, setIsSyllabus] = useState(false);
  const [choosingExam, setChoosingExam] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selected = useRef<Selection | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRequest = useRef(0);

  function discard() {
    const current = selected.current;
    if (current) releaseFile(current.asset);
    selected.current = null;
    setSelection(null);
    setError('');
    setMessage('');
  }

  useEffect(() => {
    alive.current = true;
    let active = true;
    listExams(ownerId)
      .then((result) => {
        if (active) setExams(result);
      })
      .catch(() => {
        if (active) setError('Could not load exam choices. Refresh this page to link an exam.');
      });
    listNotes(ownerId)
      .then((result) => {
        if (active) setNotes(result);
      })
      .catch(() => {
        if (active) setError('Could not load your notes. Check your connection and refresh.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
      controller.current?.abort();
      if (selected.current) releaseFile(selected.current.asset);
    };
  }, [ownerId]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await listNotes(ownerId);
      if (alive.current) setNotes(result);
    } catch {
      if (alive.current) setError('Could not load your notes. Check your connection and refresh.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  async function pick() {
    if (locked.current) return;
    // Keep the picker button usable after a browser cancels without dispatching an event.
    setError('');
    setMessage('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        base64: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!alive.current || locked.current) {
        releaseFile(asset);
        return;
      }
      if (!/\.(pdf|docx|txt|md|markdown)$/i.test(asset.name)) {
        releaseFile(asset);
        throw new Error(
          'Choose PDF, Word .docx, text or Markdown. Save older .doc files as .docx first.',
        );
      }
      if (asset.size === 0 || (asset.size ?? 0) > MAX_UPLOAD_BYTES) {
        releaseFile(asset);
        throw new Error('Choose a non-empty file smaller than 4 MB.');
      }
      discard();
      const next = { asset, id: randomUUID() };
      selected.current = next;
      setSelection(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The file picker could not open. Please try again.',
      );
    }
  }

  async function upload() {
    if (!selected.current || locked.current) return;
    const current = selected.current;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 120_000);
    try {
      const result = await uploadNotes(current.asset, current.id, abort.signal, {
        examId,
        isSyllabus,
      });
      if (!alive.current) return;
      discard();
      if (result.status === 'ready') {
        setMessage('Your notes are saved. Open them below to check the extracted text.');
      } else if (result.status === 'processing') {
        setMessage(
          'Your file is still processing. Refresh your notes shortly to check its progress.',
        );
      }
      await refresh();
      if (alive.current && result.status === 'failed') {
        setError(
          `${result.reason || 'The file could not be read.'} Choose a corrected file to upload again.`,
        );
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : 'Could not upload this file. Try again.');
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function showText(id: string) {
    const version = ++previewRequest.current;
    setPreview({ id, chunks: [], loading: true, error: '' });
    try {
      const chunks = await readChunks(id);
      if (alive.current && version === previewRequest.current)
        setPreview({ id, chunks, loading: false, error: '' });
    } catch {
      if (alive.current && version === previewRequest.current)
        setPreview({
          id,
          chunks: [],
          loading: false,
          error: 'Could not load this text. Try opening the note again.',
        });
    }
  }

  return (
    <Page>
      <PageHead title="Your notes" />
      <Section style={styles.section}>
        <View style={styles.heading}>
          <AppText variant="headline">Your notes</AppText>
          <AppText tone="inkMuted">
            Bring the notes you already study from. Only their text is saved to your account.
          </AppText>
        </View>
        <WorkspaceLinks />
        <View
          style={[styles.upload, { backgroundColor: colors.surface, borderColor: colors.line }]}
        >
          <AppText variant="title">Add a file</AppText>
          <AppText variant="small" tone="inkMuted">
            Optional: choose an exam and file purpose before selecting a file.
          </AppText>
          <Button
            variant="quiet"
            disabled={busy || !!selection}
            onPress={() => setChoosingExam(!choosingExam)}
          >
            {examId
              ? `Exam: ${exams.find((exam) => exam.id === examId)?.title ?? 'Selected exam'}`
              : 'Link an exam (optional)'}
          </Button>
          {choosingExam && !selection && (
            <View style={styles.heading}>
              <Button
                variant="quiet"
                disabled={busy}
                onPress={() => {
                  setExamId(null);
                  setChoosingExam(false);
                }}
              >
                No linked exam
              </Button>
              {exams.map((exam) => (
                <Button
                  key={exam.id}
                  variant="quiet"
                  disabled={busy}
                  onPress={() => {
                    setExamId(exam.id);
                    setChoosingExam(false);
                  }}
                >{`${exam.title} — ${exam.examDate}`}</Button>
              ))}
              {exams.length === 0 && (
                <AppText>No exams yet. You can upload without linking one.</AppText>
              )}
            </View>
          )}
          <Button
            variant="quiet"
            disabled={busy || !!selection}
            onPress={() => setIsSyllabus(!isSyllabus)}
          >
            {isSyllabus ? 'File purpose: syllabus' : 'File purpose: study notes'}
          </Button>
          {isSyllabus && (
            <AppText variant="small" tone="inkMuted">
              This saves the syllabus text only. No exam dates are added automatically.
            </AppText>
          )}
          <AppText tone="inkMuted" style={styles.prose}>
            PDF, Word (.docx), text or Markdown. Up to 4 MB per upload. Split longer PDFs into
            smaller files. Images and handwriting are not read yet.
          </AppText>
          <AppText variant="small" tone="inkMuted" style={styles.prose}>
            Your file is sent to Cramrade’s server to extract its text, then discarded. Your
            original stays on your device. Text extraction does not use AI. Saved text can be used
            to make study questions with AI.
          </AppText>
          {selection && <AppText bold>{selection.asset.name}</AppText>}
          <View style={styles.actions}>
            <Button variant="quiet" disabled={busy} onPress={() => void pick()}>
              {selection ? 'Choose another file' : 'Choose a file'}
            </Button>
            {selection && (
              <>
                <Button busy={busy} busyLabel="Reading and saving…" onPress={() => void upload()}>
                  Upload notes
                </Button>
                <Button variant="quiet" disabled={busy} onPress={discard}>
                  Remove file
                </Button>
              </>
            )}
          </View>
          {busy && (
            <AppText accessibilityLiveRegion="polite">
              Keep this page open while your notes are saved.
            </AppText>
          )}
          {!!error && <AppText role="alert">{error}</AppText>}
          {!!message && <AppText accessibilityLiveRegion="polite">{message}</AppText>}
        </View>
        <View style={styles.actions}>
          <AppText variant="title">Saved notes</AppText>
          <Button variant="quiet" disabled={busy || loading} onPress={() => void refresh()}>
            Refresh notes
          </Button>
        </View>
        {loading ? (
          <AppText>Loading your notes…</AppText>
        ) : notes.length === 0 ? (
          <AppText tone="inkMuted">No notes yet. Choose a file above to get started.</AppText>
        ) : (
          notes.map((note) => (
            <View key={note.id} style={[styles.note, { borderColor: colors.line }]}>
              <AppText variant="title">{note.title}</AppText>
              <AppText tone="inkMuted" variant="small">
                {note.originalFilename ?? 'Typed notes'}
                {note.status === 'processing'
                  ? ' (processing)'
                  : note.status === 'failed'
                    ? ' (failed)'
                    : ''}
              </AppText>
              {note.status === 'failed' && (
                <AppText role="alert">
                  {note.failureReason || 'This file could not be read.'} Choose a corrected file to
                  upload again.
                </AppText>
              )}
              <Button
                variant="quiet"
                disabled={note.status !== 'ready'}
                onPress={() => void showText(note.id)}
              >
                Read extracted text
              </Button>
              {note.isSyllabus && note.status === 'ready' && <LinkButton href="/syllabus" variant="quiet">Find and confirm syllabus dates</LinkButton>}
              {preview?.id === note.id && (
                <View style={styles.heading}>
                  {preview.loading ? (
                    <AppText>Loading text…</AppText>
                  ) : preview.error ? (
                    <AppText role="alert">{preview.error}</AppText>
                  ) : preview.chunks.length === 0 ? (
                    <AppText>No text is available yet. Refresh after processing finishes.</AppText>
                  ) : (
                    preview.chunks.map((chunk) => (
                      <AppText selectable key={chunk.id} style={styles.prose}>
                        {chunk.text}
                      </AppText>
                    ))
                  )}
                  <Button
                    variant="quiet"
                    onPress={() => {
                      previewRequest.current++;
                      setPreview(null);
                    }}
                  >
                    Close text
                  </Button>
                </View>
              )}
            </View>
          ))
        )}
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.lg },
  heading: { gap: Spacing.sm },
  prose: { maxWidth: Layout.proseMaxWidth },
  upload: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.panel,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  note: { gap: Spacing.sm, paddingVertical: Spacing.lg, borderTopWidth: 1 },
});
