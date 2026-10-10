import type { Exam, ScheduleWarning, StudySession } from '@cramrade/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { WorkspacePage, workspaceStyles as s } from '@/components/frame/workspace-page';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { CalendarPanel } from '@/features/calendar/calendar-panel';
import { listExams } from '@/lib/exam-data';
import { errorMessage } from '@/lib/functions';
import {
  calendarDay,
  loadPlan,
  loadSettings,
  rebuildPlan,
  setSessionStatus,
} from '@/lib/plan-data';
import { supabase } from '@/lib/supabase';

const warningText: Record<ScheduleWarning['code'], string> = {
  exam_past: 'This exam has passed and has no planned sessions.',
  no_questions:
    'Some notes have no checked questions yet. Upload notes linked to this exam, then rebuild.',
  load_increased: 'Extra sessions were added to fit the material before the exam.',
  not_enough_days:
    'There may not be enough study days to cover everything. Check your pace and days off.',
};

export function ScheduleScreen({ ownerId }: { ownerId: string }) {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [zone, setZone] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([]);
  const lock = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    const [plan, exams, settings] = await Promise.all([
      loadPlan(ownerId),
      listExams(ownerId),
      loadSettings(ownerId),
    ]);
    if (current === version.current) {
      setSessions(plan);
      setExams(exams);
      setZone(settings.timeZone);
      setLoading(false);
    }
  }, [ownerId]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch((e) => {
        setError(errorMessage(e));
        setLoading(false);
      });
      return () => {
        version.current++;
      };
    }, [refresh]),
  );
  async function rebuild(skipId?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (skipId) await setSessionStatus(ownerId, skipId, 'skipped');
      const result = await rebuildPlan();
      setWarnings(result.warnings);
      await refresh();
    } catch (e) {
      setError(`${skipId ? 'The skip or rebuild could not finish. ' : ''}${errorMessage(e)}`);
      await refresh().catch(() => undefined);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    // Date changes and newly generated questions can arrive from another tab or device.
    const channel = supabase
      .channel(`plan:${ownerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'study_sessions', filter: `owner_id=eq.${ownerId}` },
        () => {
          void refresh().catch((e) => setError(errorMessage(e)));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ownerId, refresh]);
  const today = calendarDay(new Date(), zone);
  const planned = sessions.filter((session) => session.status === 'planned');
  const due = planned.filter(
    (session) => calendarDay(new Date(session.scheduledFor), zone) <= today,
  );
  const upcoming = planned.filter(
    (session) => calendarDay(new Date(session.scheduledFor), zone) > today,
  );
  function renderSession(session: StudySession) {
    return (
      <View key={session.id} style={s.panel}>
        <AppText bold tone="session">
          {new Date(session.scheduledFor).toLocaleString(undefined, {
            timeZone: zone,
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </AppText>
        <AppText variant="title">
          {exams.find((e) => e.id === session.examId)?.title ?? 'Exam'}
          {session.isFinalPass ? ' — final pass' : ''}
        </AppText>
        {calendarDay(new Date(session.scheduledFor), zone) < today && (
          <AppText>This session was missed. Rebuild to plan from today.</AppText>
        )}
        <View style={s.actions}>
          <LinkButton href={{ pathname: '/study', params: { sessionId: session.id } }}>
            Start session
          </LinkButton>
          <Button variant="quiet" disabled={busy} onPress={() => void rebuild(session.id)}>
            Skip and rebuild
          </Button>
        </View>
      </View>
    );
  }
  return (
    <WorkspacePage
      title="Your study plan"
      intro="Short sessions leading up to each exam. Your plan is saved to your account and shared across your devices."
    >
      <View style={s.actions}>
        <Button
          busy={busy}
          busyLabel="Rebuilding…"
          disabled={loading}
          onPress={() => void rebuild()}
        >
          Rebuild plan from today
        </Button>
        <Button
          disabled={busy || loading}
          variant="quiet"
          onPress={() => {
            void refresh().catch((e) => setError(errorMessage(e)));
          }}
        >
          Refresh plan
        </Button>
      </View>
      <AppText variant="small" tone="inkMuted">
        Times shown in {zone}. Change your pace, days off and time zone in Study settings.
      </AppText>
      {!!error && <AppText role="alert">{error}</AppText>}
      {warnings.map((warning, i) => (
        <AppText key={i}>
          {exams.find((e) => e.id === warning.examId)?.title ?? 'Plan'}: {warningText[warning.code]}
        </AppText>
      ))}
      {loading ? (
        <AppText>Loading your plan…</AppText>
      ) : (
        <>
          <AppText variant="title">Today and overdue</AppText>
          {due.length ? (
            due.map(renderSession)
          ) : (
            <AppText tone="inkMuted">No sessions due today.</AppText>
          )}
          <AppText variant="title">Coming up</AppText>
          {upcoming.map(renderSession)}
          {!planned.length && (
            <AppText>
              No planned sessions yet. Add an exam, upload notes linked to it, then rebuild once
              questions are ready.
            </AppText>
          )}
          <AppText variant="title">Completed and skipped</AppText>
          {sessions
            .filter((session) => session.status !== 'planned')
            .slice(-20)
            .map((session) => (
              <AppText key={session.id}>
                {exams.find((e) => e.id === session.examId)?.title ?? 'Exam'} — {session.status} —{' '}
                {new Date(session.scheduledFor).toLocaleDateString(undefined, { timeZone: zone })}
              </AppText>
            ))}
        </>
      )}
      <CalendarPanel ownerId={ownerId} />
    </WorkspacePage>
  );
}
