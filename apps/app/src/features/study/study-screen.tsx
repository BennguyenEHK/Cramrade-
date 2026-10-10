import type { Exam, Note, Question } from '@cramrade/shared';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WorkspacePage, workspaceStyles as s } from '@/components/frame/workspace-page';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { listExams } from '@/lib/exam-data';
import { listNotes, readChunks } from '@/lib/note-data';
import { errorMessage } from '@/lib/functions';
import { rebuildPlan, setSessionStatus } from '@/lib/plan-data';
import { loadStudy, saveAttempt } from '@/lib/study-data';
import { matchesAnswer } from './answers';

export function StudyScreen({ ownerId, sessionId }: { ownerId: string; sessionId?: string }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [source, setSource] = useState<{ examId?: string; noteId?: string }>({});
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flashcards, setFlashcards] = useState(false);
  const [answer, setAnswer] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [resultCount, setResultCount] = useState(0);
  const attemptId = useRef(randomUUID());
  const pending = useRef<{ answer: string | null; isCorrect: boolean } | null>(null);
  const lock = useRef(false);
  const sourceVersion = useRef(0);
  function resetQuestion() {
    setAnswer('');
    setFeedback(null);
    setFlipped(false);
    setSourceText('');
    setSourceLoading(false);
    sourceVersion.current++;
    attemptId.current = randomUUID();
    pending.current = null;
  }
  async function start(asFlashcards: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await loadStudy(ownerId, sessionId, source.examId, source.noteId);
      const remaining = result.questions.filter((q) => !result.answered.includes(q.id));
      setQuestions(remaining);
      setIndex(0);
      setFlashcards(asFlashcards);
      setFinished(false);
      setResultCount(0);
      if (sessionId && result.questions.length && !remaining.length) {
        await setSessionStatus(ownerId, sessionId, 'done');
        setFinished(true);
      }
      resetQuestion();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // A scheduled session starts automatically; reviews wait for the student's mode choice.
  useEffect(() => {
    if (sessionId) {
      const timer = setTimeout(() => void start(false), 0);
      return () => clearTimeout(timer);
    } else {
      let alive = true;
      Promise.all([listExams(ownerId), listNotes(ownerId)])
        .then(([exams, notes]) => {
          if (alive) {
            setExams(exams);
            setNotes(notes.filter((n) => n.status === 'ready' && !n.isSyllabus));
          }
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e));
        });
      return () => {
        alive = false;
      };
    }
    // This screen is keyed by account and session; mode selection is a separate action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, sessionId]);
  const question = questions?.[index];
  async function submit(value?: string, assessment?: boolean) {
    if (!question || lock.current || feedback !== null) return;
    const submitted = value ?? answer;
    if (assessment === undefined && !submitted.trim()) {
      setError('Choose or enter an answer first.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    // Freeze a request after a network failure so a retry cannot silently change its result.
    const values = pending.current ?? {
      answer: assessment === undefined ? submitted : null,
      isCorrect:
        assessment ??
        (question.kind === 'multiple_choice'
          ? submitted === question.answer
          : matchesAnswer(submitted, question.answer)),
    };
    pending.current = values;
    try {
      await saveAttempt({
        ...values,
        id: attemptId.current,
        userId: ownerId,
        sessionId,
        questionId: question.id,
      });
      setFeedback(values.isCorrect);
      setFlipped(true);
      if (values.isCorrect) setResultCount((count) => count + 1);
    } catch (e) {
      setError(`Answer not confirmed saved. Retry before continuing. ${errorMessage(e)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function next() {
    if (lock.current) return;
    if (questions && index + 1 < questions.length) {
      setIndex(index + 1);
      resetQuestion();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (sessionId) await setSessionStatus(ownerId, sessionId, 'done');
      setFinished(true);
      await rebuildPlan().catch((e) =>
        setError(`Results saved. The plan could not rebuild: ${errorMessage(e)}`),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function showSource() {
    if (!question) return;
    const version = ++sourceVersion.current;
    setSourceLoading(true);
    setError('');
    try {
      const chunks = await readChunks(question.noteId);
      if (sourceVersion.current === version)
        setSourceText(
          chunks.find((c) => c.id === question.chunkId)?.text ??
            'Source text is no longer available.',
        );
    } catch (e) {
      if (sourceVersion.current === version) setError(errorMessage(e));
    } finally {
      if (sourceVersion.current === version) setSourceLoading(false);
    }
  }
  return (
    <WorkspacePage
      title={sessionId ? 'Study session' : 'Review your notes'}
      intro="Practice with checked questions from your own notes. Every answer is saved to your account."
    >
      {!!error && <AppText role="alert">{error}</AppText>}
      {finished ? (
        <View style={s.stack}>
          <AppText variant="title">Session finished</AppText>
          <AppText>{resultCount} correct in this visit. Your answers are saved.</AppText>
          <LinkButton href="/schedule">Back to your plan</LinkButton>
          {!sessionId && (
            <Button
              disabled={busy}
              onPress={() => {
                setQuestions(null);
                setFinished(false);
                resetQuestion();
              }}
            >
              Start another review
            </Button>
          )}
        </View>
      ) : questions === null ? (
        sessionId ? (
          busy ? (
            <AppText>Loading your session…</AppText>
          ) : (
            <Button onPress={() => void start(false)}>Open scheduled session</Button>
          )
        ) : (
          <>
            <AppText variant="title">What would you like to review?</AppText>
            <View style={s.actions}>
              <Button
                variant={!source.examId && !source.noteId ? 'primary' : 'quiet'}
                disabled={busy}
                onPress={() => setSource({})}
              >
                All my notes
              </Button>
              {exams.map((exam) => (
                <Button
                  key={exam.id}
                  disabled={busy}
                  variant={source.examId === exam.id ? 'primary' : 'quiet'}
                  onPress={() => setSource({ examId: exam.id })}
                >
                  {exam.title}
                </Button>
              ))}
              {notes.map((note) => (
                <Button
                  key={note.id}
                  disabled={busy}
                  variant={source.noteId === note.id ? 'primary' : 'quiet'}
                  onPress={() => setSource({ noteId: note.id })}
                >
                  {note.originalFilename ?? note.title}
                </Button>
              ))}
            </View>
            <View style={s.actions}>
              <Button busy={busy} onPress={() => void start(false)}>
                Start quick quiz
              </Button>
              <Button disabled={busy} variant="quiet" onPress={() => void start(true)}>
                Start flashcards
              </Button>
            </View>
          </>
        )
      ) : !question ? (
        <View style={s.stack}>
          <AppText>
            No checked questions available for this selection yet. Upload notes and allow time for
            question generation.
          </AppText>
          <LinkButton href="/notes">Open notes</LinkButton>
          <Button variant="quiet" disabled={busy} onPress={() => void start(flashcards)}>
            Try again
          </Button>
        </View>
      ) : (
        <View style={s.panel}>
          <AppText tone="session" bold>
            {flashcards ? 'Flashcard' : 'Question'} {index + 1} of {questions.length}
          </AppText>
          <AppText variant="title">{question.prompt}</AppText>
          {feedback === null && (flashcards || question.kind === 'flashcard') ? (
            <>
              {!flipped ? (
                <Button onPress={() => setFlipped(true)}>Show answer</Button>
              ) : (
                <>
                  <AppText>{question.answer}</AppText>
                  <View style={s.actions}>
                    <Button disabled={busy} onPress={() => void submit(undefined, true)}>
                      I remembered it
                    </Button>
                    <Button
                      disabled={busy}
                      variant="quiet"
                      onPress={() => void submit(undefined, false)}
                    >
                      I need to practice
                    </Button>
                  </View>
                </>
              )}
            </>
          ) : feedback === null ? (
            <>
              {question.kind === 'multiple_choice' && question.choices ? (
                <View style={s.stack}>
                  {question.choices.map((choice) => (
                    <Button
                      key={choice}
                      disabled={busy}
                      variant="quiet"
                      onPress={() => void submit(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </View>
              ) : (
                <>
                  <TextField
                    label="Your answer"
                    editable={!busy}
                    value={answer}
                    onChangeText={setAnswer}
                  />
                  <AppText variant="small">
                    Short answers are checked by exact text, ignoring capitalization and extra
                    spaces.
                  </AppText>
                  <Button busy={busy} onPress={() => void submit()}>
                    Check answer
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <AppText bold accessibilityLiveRegion="polite">
                {feedback ? 'Correct.' : 'Keep practicing.'} Answer saved.
              </AppText>
              <AppText>Answer: {question.answer}</AppText>
              <Button busy={busy} onPress={() => void next()}>
                {index + 1 === questions.length ? 'Finish session' : 'Next question'}
              </Button>
            </>
          )}
          <Button variant="quiet" disabled={sourceLoading} onPress={() => void showSource()}>
            Show me where this is in my notes
          </Button>
          {sourceLoading && <AppText>Loading source…</AppText>}
          {!!sourceText && (
            <View style={s.stack}>
              <AppText selectable bold>
                “{question.sourceQuote}”
              </AppText>
              <AppText selectable>{sourceText}</AppText>
            </View>
          )}
        </View>
      )}
    </WorkspacePage>
  );
}
