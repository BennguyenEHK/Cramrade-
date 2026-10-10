// supabase/functions/calendar-feed/index.ts
// The student's plan as a calendar subscription. Public on purpose
// (verify_jwt = false): calendar apps cannot send a login. The 64-character
// random token in the link is the only key, so an unknown or malformed
// token gets an empty 404 that says nothing about which tokens exist.
// Cramrade only sends to the calendar; it never reads it.
import { db } from '../_shared/db.ts';
import { buildIcs, type IcsExam, type IcsSession } from '../_shared/ics.ts';

const TOKEN = /^[0-9a-f]{64}$/;
const SESSION_MINUTES = 20;
const DAY_MS = 86_400_000;

interface SessionRow {
  id: string;
  exam_id: string;
  scheduled_for: string;
  session_questions: { position: number; questions: { topics: { title: string } | null } | null }[];
}

function empty(status: number): Response {
  return new Response(null, { status });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!TOKEN.test(token)) return empty(404);

  const { data: feed, error: feedError } = await db
    .from('calendar_feeds')
    .select('user_id')
    .eq('token', token)
    .maybeSingle();
  if (feedError) {
    console.error('calendar-feed: look up token', feedError);
    return empty(500);
  }
  if (!feed) return empty(404);

  const now = new Date();
  const yesterday = new Date(now.getTime() - DAY_MS);

  const [examsResult, sessionsResult] = await Promise.all([
    db
      .from('exams')
      .select('id, title, exam_date')
      .eq('owner_id', feed.user_id)
      .gte('exam_date', yesterday.toISOString().slice(0, 10))
      .order('exam_date'),
    db
      .from('study_sessions')
      .select('id, exam_id, scheduled_for, session_questions(position, questions(topics(title)))')
      .eq('owner_id', feed.user_id)
      .eq('status', 'planned')
      .gte('scheduled_for', yesterday.toISOString())
      .order('scheduled_for')
      .limit(1000),
  ]);
  if (examsResult.error || sessionsResult.error) {
    console.error('calendar-feed: load plan', examsResult.error ?? sessionsResult.error);
    return empty(500);
  }

  const examRows = (examsResult.data ?? []) as { id: string; title: string; exam_date: string }[];
  const titleOf = new Map(examRows.map((e) => [e.id, e.title]));
  const exams: IcsExam[] = examRows.map((e) => ({ id: e.id, title: e.title, examDate: e.exam_date }));

  const sessions: IcsSession[] = ((sessionsResult.data ?? []) as SessionRow[]).map((s) => {
    const topicTitles = [...s.session_questions]
      .sort((a, b) => a.position - b.position)
      .map((sq) => sq.questions?.topics?.title)
      .filter((title): title is string => Boolean(title));
    return {
      id: s.id,
      examTitle: titleOf.get(s.exam_id) ?? 'Exam',
      topicTitles: [...new Set(topicTitles)],
      startsAt: s.scheduled_for,
      minutes: SESSION_MINUTES,
    };
  });

  const body = buildIcs({ calName: 'Cramrade', exams, sessions, now });
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="cramrade.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  });
});
