import type { Question } from '@cramrade/shared';
import { supabase } from './supabase';

type QuestionRow = {
  id: string;
  note_id: string;
  chunk_id: string;
  exam_id: string | null;
  topic_id: string | null;
  kind: Question['kind'];
  prompt: string;
  choices: string[] | null;
  answer: string;
  source_quote: string;
  verified: boolean;
  created_at: string;
};
export function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    noteId: row.note_id,
    chunkId: row.chunk_id,
    examId: row.exam_id,
    topicId: row.topic_id,
    kind: row.kind,
    prompt: row.prompt,
    choices: row.choices,
    answer: row.answer,
    sourceQuote: row.source_quote,
    verified: row.verified,
    createdAt: row.created_at,
  };
}
export async function loadStudy(
  ownerId: string,
  sessionId?: string,
  examId?: string,
  noteId?: string,
) {
  let ids: string[] | null = null;
  let answered: string[] = [];
  if (sessionId) {
    const session = await supabase
      .from('study_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .single();
    if (session.error) throw session.error;
    if (session.data.status !== 'planned')
      throw new Error(
        'This session is already completed or skipped. Start an on-demand review instead.',
      );
    const list = await supabase
      .from('session_questions')
      .select('question_id')
      .eq('session_id', sessionId)
      .order('position');
    if (list.error) throw list.error;
    ids = list.data.map((row) => row.question_id);
    const attempts = await supabase
      .from('attempts')
      .select('question_id')
      .eq('session_id', sessionId)
      .eq('user_id', ownerId);
    if (attempts.error) throw attempts.error;
    answered = attempts.data.map((row) => row.question_id);
    if (!ids.length) return { questions: [], answered };
  }
  let query = supabase.from('questions').select('*').eq('verified', true);
  if (ids) query = query.in('id', ids);
  else {
    // Scope the review to notes owned by this student, rather than all visible group notes.
    let notes = supabase
      .from('notes')
      .select('id')
      .eq('owner_id', ownerId)
      .eq('is_syllabus', false);
    if (noteId) notes = notes.eq('id', noteId);
    if (examId) notes = notes.eq('exam_id', examId);
    const result = await notes;
    if (result.error) throw result.error;
    if (!result.data.length) return { questions: [], answered };
    query = query
      .in(
        'note_id',
        result.data.map((row) => row.id),
      )
      .limit(7)
      .order('created_at', { ascending: false });
  }
  const { data, error } = await query;
  if (error) throw error;
  const questions = (data as QuestionRow[]).map(mapQuestion);
  if (ids && questions.length !== ids.length)
    throw new Error(
      'Some questions in this session are no longer available. Return to Schedule and rebuild your plan.',
    );
  if (ids) questions.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { questions, answered };
}
export async function saveAttempt(values: {
  id: string;
  userId: string;
  sessionId?: string;
  questionId: string;
  answer: string | null;
  isCorrect: boolean;
}) {
  const { error } = await supabase
    .from('attempts')
    .insert({
      id: values.id,
      user_id: values.userId,
      session_id: values.sessionId ?? null,
      question_id: values.questionId,
      answer: values.answer,
      is_correct: values.isCorrect,
    });
  // Retrying the same request must not record a second answer.
  if (error && error.code !== '23505') throw error;
}
