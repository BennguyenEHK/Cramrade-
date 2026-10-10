import type { Exam, Note, QuestionKind } from '@cramrade/shared';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { WorkspacePage, workspaceStyles as s } from '@/components/frame/workspace-page';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { LinkButton } from '@/components/ui/link-button';
import { useAuth } from '@/features/auth/auth-provider';
import { listExams } from '@/lib/exam-data';
import { listNotes } from '@/lib/note-data';
import { errorMessage, invoke } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { quizPhase } from './clock';
import { showFullScreen } from './host-display';

type Room = {
  id: string;
  code: string;
  title: string;
  hostId: string;
  mode: 'solo' | 'group';
  status: 'lobby' | 'running' | 'finished';
  secondsPerQuestion: number;
  resultsSeconds: number;
  currentQuestionIndex: number;
  questionStartedAt: string | null;
  questionCount: number;
  serverNow: string;
};
type Player = { id: string; room_id: string; user_id: string; nickname: string; score: number };
type CurrentQuestion = {
  question_id: string;
  question_index: number;
  prompt: string;
  kind: QuestionKind;
  choices: string[] | null;
  answer: string | null;
  server_now: string;
};

export function QuizScreen({ roomId, joinCode }: { roomId?: string; joinCode?: string }) {
  const { session, loading } = useAuth();
  const [code, setCode] = useState(joinCode ?? '');
  const [nickname, setNickname] = useState('');
  const [exams, setExams] = useState<Exam[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [source, setSource] = useState<{ examId?: string; noteId?: string }>({});
  const [count, setCount] = useState('10');
  const [seconds, setSeconds] = useState('20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joinError, setJoinError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!session || session.user.is_anonymous || roomId) return;
    let alive = true;
    Promise.all([listExams(session.user.id), listNotes(session.user.id)])
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
  }, [session, roomId]);
  async function join() {
    if (lock.current) return;
    if (!/^[a-z0-9]{6}$/i.test(code.trim()) || !nickname.trim() || nickname.trim().length > 24) {
      setJoinError('Enter a six-character room code and a nickname of 1 to 24 characters.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setJoinError('');
    try {
      const auth = await supabase.auth.getSession();
      if (auth.error) throw auth.error;
      if (!auth.data.session) {
        const result = await supabase.auth.signInAnonymously();
        if (result.error) throw result.error;
      }
      const { data, error } = await supabase.rpc('join_quiz_room', {
        code: code.trim().toUpperCase(),
        nickname: nickname.trim(),
      });
      if (error) throw error;
      const player = (Array.isArray(data) ? data[0] : data) as Player;
      if (!player?.room_id) throw new Error('Joining did not return a room. Please try again.');
      router.replace({ pathname: '/quiz', params: { roomId: player.room_id } });
    } catch (e) {
      const message = errorMessage(e);
      setJoinError(
        /anonymous.*disabled/i.test(message)
          ? 'Guest joining is unavailable right now. You can sign in with an account and try again, or ask the host for help.'
          : message
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function create(mode: 'solo' | 'group') {
    if (lock.current || !session) return;
    if (!source.examId && !source.noteId) {
      setError('Choose an exam or a note first.');
      return;
    }
    if (
      !/^\d+$/.test(count) ||
      +count < 1 ||
      +count > 50 ||
      !/^\d+$/.test(seconds) ||
      +seconds < 5 ||
      +seconds > 300
    ) {
      setError('Choose 1–50 questions and 5–300 seconds per question.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await invoke<{ roomId: string }>('quiz-create', {
        source,
        mode,
        count: +count,
        secondsPerQuestion: +seconds,
      });
      router.push({ pathname: '/quiz', params: { roomId: result.roomId } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (loading)
    return (
      <WorkspacePage title="Quiz" intro="Opening your quiz…">
        <AppText>Checking your sign-in…</AppText>
      </WorkspacePage>
    );
  if (roomId && session)
    return (
      <QuizRoom key={`${roomId}:${session.user.id}`} roomId={roomId} userId={session.user.id} />
    );
  return (
    <WorkspacePage
      title="Quiz together"
      intro="Play with questions made from your notes. Join with a nickname, host a room, or practice alone."
    >
      {!!error && <AppText role="alert">{error}</AppText>}
      {roomId && !session && (
        <AppText>
          Your previous sign-in is unavailable. Rejoin with the room code. Scores can only be
          recovered with the same browser sign-in.
        </AppText>
      )}
      <View style={s.panel}>
        <AppText variant="title">Join a quiz</AppText>
        <AppText>
          No account or installation needed. Keep using this browser to rejoin with your score.
        </AppText>
        <TextField
          label="Room code"
          autoCapitalize="characters"
          value={code}
          maxLength={6}
          editable={!busy}
          onChangeText={setCode}
        />
        <TextField
          label="Nickname"
          value={nickname}
          maxLength={24}
          editable={!busy}
          onChangeText={setNickname}
        />
        {!!joinError && <AppText role="alert">{joinError}</AppText>}
        <Button busy={busy} busyLabel="Joining…" onPress={() => void join()}>
          Join quiz
        </Button>
        {!!joinError && !session && <LinkButton href="/sign-in">Sign in</LinkButton>}
      </View>
      {session && !session.user.is_anonymous ? (
        <View style={s.panel}>
          <AppText variant="title">Make a quiz from your notes</AppText>
          <View style={s.actions}>
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
          {!exams.length && !notes.length && (
            <AppText>Add notes first, then return once questions are ready.</AppText>
          )}
          <TextField
            label="Number of questions"
            value={count}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={setCount}
          />
          <TextField
            label="Seconds per question"
            value={seconds}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={setSeconds}
          />
          <View style={s.actions}>
            <Button busy={busy} onPress={() => void create('solo')}>
              Play alone
            </Button>
            {Platform.OS === 'web' && (
              <Button disabled={busy} variant="quiet" onPress={() => void create('group')}>
                Host a group quiz
              </Button>
            )}
          </View>
          {Platform.OS !== 'web' && (
            <AppText>Open Cramrade in a computer browser to host a group quiz.</AppText>
          )}
        </View>
      ) : (
        <LinkButton href="/sign-in" variant="quiet">
          Sign in to create a quiz
        </LinkButton>
      )}
    </WorkspacePage>
  );
}

function QuizRoom({ roomId, userId }: { roomId: string; userId: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [question, setQuestion] = useState<CurrentQuestion | null>(null);
  const [answer, setAnswer] = useState('');
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const offset = useRef(0);
  const currentRoom = useRef<Room | null>(null);
  const syncLock = useRef(false);
  const actionLock = useRef(false);
  const alive = useRef(true);
  const sync = useCallback(async () => {
    if (syncLock.current || !alive.current) return;
    syncLock.current = true;
    try {
      const result = await invoke<{ room: Room }>('quiz-advance', {
        roomId,
        expectedIndex: Math.max(0, currentRoom.current?.currentQuestionIndex ?? 0),
      });
      if (!alive.current) return;
      const next = result.room;
      offset.current = Date.parse(next.serverNow) - Date.now();
      const previousIndex = currentRoom.current?.currentQuestionIndex;
      currentRoom.current = next;
      setRoom(next);
      setNow(Date.now() + offset.current);
      if (previousIndex !== next.currentQuestionIndex) {
        setAnswer('');
        setAnsweredId(null);
        setReceipt('');
        setQuestion(null);
      }
      const playerResult = await supabase
        .from('quiz_players')
        .select('*')
        .eq('room_id', roomId)
        .order('score', { ascending: false })
        .order('joined_at');
      if (playerResult.error) throw playerResult.error;
      if (alive.current) setPlayers(playerResult.data as Player[]);
      if (next.status === 'running') {
        const result = await supabase.rpc('current_quiz_question', { room_id: roomId });
        if (result.error) throw result.error;
        const q = (Array.isArray(result.data) ? result.data[0] : result.data) as
          CurrentQuestion | undefined;
        if (alive.current && q && q.question_index === next.currentQuestionIndex) {
          offset.current = Date.parse(q.server_now) - Date.now();
          setQuestion(q);
          const player = (playerResult.data as Player[]).find((p) => p.user_id === userId);
          if (player) {
            const saved = await supabase
              .from('quiz_answers')
              .select('question_id')
              .eq('room_id', roomId)
              .eq('player_id', player.id)
              .eq('question_id', q.question_id)
              .maybeSingle();
            if (saved.error) throw saved.error;
            if (saved.data && alive.current) setAnsweredId(q.question_id);
          }
        }
      }
      if (alive.current) setError('');
    } catch (e) {
      if (alive.current) setError(`Reconnecting… ${errorMessage(e)}`);
    } finally {
      syncLock.current = false;
    }
  }, [roomId, userId]);
  useEffect(() => {
    alive.current = true;
    void sync();
    // Realtime gives prompt updates; polling recovers missed events and advances the server clock.
    const poll = setInterval(() => {
      if (currentRoom.current?.status !== 'finished') void sync();
    }, 2000);
    const tick = setInterval(() => setNow(Date.now() + offset.current), 200);
    const channel = supabase
      .channel(`quiz-ui:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_rooms', filter: `id=eq.${roomId}` },
        () => void sync(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_players', filter: `room_id=eq.${roomId}` },
        () => void sync(),
      )
      .subscribe();
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [roomId, sync]);
  async function start() {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await invoke('quiz-start', { roomId });
      await sync();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function submit(value: string) {
    if (!question || actionLock.current || answeredId === question.question_id) return;
    if (!value.trim()) {
      setError('Enter an answer first.');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await invoke<{ isCorrect: boolean; points: number; score: number }>(
        'quiz-answer',
        { roomId, questionId: question.question_id, answer: value },
      );
      if (alive.current && currentRoom.current?.currentQuestionIndex === question.question_index) {
        setAnsweredId(question.question_id);
        setReceipt(`Answer saved. ${result.points} points.`);
      }
      await sync();
    } catch (e) {
      setError(errorMessage(e));
      await sync();
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  if (!room)
    return (
      <WorkspacePage title="Quiz room" intro="Connecting to your room…">
        {!!error && <AppText role="alert">{error}</AppText>}
        <Button onPress={() => void sync()}>Retry connection</Button>
        <LinkButton href="/quiz" variant="quiet">
          Back to quizzes
        </LinkButton>
      </WorkspacePage>
    );
  const host = room.hostId === userId && room.mode === 'group';
  const phase = quizPhase(
    room.questionStartedAt,
    room.secondsPerQuestion,
    room.resultsSeconds,
    now,
  );
  const joinLink =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/quiz?code=${room.code}`
      : '';
  return (
    <WorkspacePage
      fullWidth={host}
      title={room.title}
      intro={
        host
          ? 'Host screen. Share the room code and start when everyone has joined.'
          : 'Your answers and scores are recorded by the quiz server.'
      }
    >
      {host && Platform.OS === 'web' && (
        <Button
          variant="quiet"
          onPress={() => {
            void showFullScreen().catch((e) => setError(errorMessage(e)));
          }}
        >
          Show full screen
        </Button>
      )}
      {!!error && <AppText role="alert">{error}</AppText>}
      {room.status === 'lobby' ? (
        <View style={s.panel}>
          <AppText variant="headline">{room.code}</AppText>
          <AppText>
            Share this code with your group. Players open Quiz and choose Join quiz.
          </AppText>
          {host && joinLink !== '' && (
            <Button
              variant="quiet"
              onPress={() => {
                void Clipboard.setStringAsync(joinLink)
                  .then(() => setMessage('Join link copied.'))
                  .catch(() => setMessage(joinLink));
              }}
            >
              Copy join link
            </Button>
          )}
          {host ? (
            Platform.OS === 'web' ? (
              <Button busy={busy} disabled={!players.length} onPress={() => void start()}>
                Start quiz
              </Button>
            ) : (
              <AppText>Open the host screen in a computer browser to start.</AppText>
            )
          ) : (
            <AppText>Waiting for the host to start…</AppText>
          )}
        </View>
      ) : room.status === 'finished' ? (
        <View style={s.stack}>
          <AppText variant="headline">Quiz finished</AppText>
          <AppText>Your final scores are below.</AppText>
          <LinkButton href="/quiz">Play again</LinkButton>
        </View>
      ) : (
        <View style={s.panel}>
          <View style={s.actions}>
            <AppText bold>
              Question {room.currentQuestionIndex + 1} of {room.questionCount}
            </AppText>
            <AppText variant="title" tone="session">
              {phase.secondsLeft}s
            </AppText>
          </View>
          {question && question.question_index === room.currentQuestionIndex ? (
            <>
              <AppText variant="headline">{question.prompt}</AppText>
              {phase.phase === 'answering' ? (
                host ? (
                  <AppText>Players are answering…</AppText>
                ) : answeredId === question.question_id ? (
                  <AppText accessibilityLiveRegion="polite">
                    {receipt || 'Answer saved. Waiting for results…'}
                  </AppText>
                ) : question.kind === 'multiple_choice' && question.choices ? (
                  <View style={s.stack}>
                    {question.choices.map((choice) => (
                      <Button
                        key={choice}
                        variant="quiet"
                        disabled={busy}
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
                      value={answer}
                      maxLength={500}
                      editable={!busy}
                      onChangeText={setAnswer}
                    />
                    <Button busy={busy} onPress={() => void submit(answer)}>
                      Send answer
                    </Button>
                  </>
                )
              ) : (
                <>
                  <AppText bold>Time is up.</AppText>
                  <AppText>Correct answer: {question.answer ?? 'Loading result…'}</AppText>
                  <AppText tone="inkMuted">The next question starts automatically.</AppText>
                </>
              )}
            </>
          ) : (
            <AppText>Loading the current question…</AppText>
          )}
        </View>
      )}
      {!!message && <AppText accessibilityLiveRegion="polite">{message}</AppText>}
      <View style={s.panel}>
        <AppText variant="title">
          {room.status === 'finished'
            ? 'Final scores'
            : room.status === 'lobby'
              ? 'Players'
              : 'Scoreboard'}
        </AppText>
        {!players.length && <AppText>Waiting for players to join.</AppText>}
        {players.map((player, i) => (
          <View key={player.id} style={s.actions}>
            <AppText bold>
              {i + 1}. {player.nickname}
              {player.user_id === userId ? ' (you)' : ''}
            </AppText>
            <AppText>{player.score} points</AppText>
          </View>
        ))}
      </View>
    </WorkspacePage>
  );
}
