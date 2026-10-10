// quiz-answer: a player answers the current question. Guests allowed.
// The text comparison happens here (isCorrectAnswer); the deadline,
// duplicate check, points and score update happen in one database call
// (public.submit_quiz_answer), timed by the database clock (spec 9.1).

import { requireUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseAnswerInput } from '../_shared/quiz-input.ts';
import { answerOutcomeError, type AnswerOutcome } from '../_shared/quiz-room.ts';
import { isCorrectAnswer, type QuestionKind } from '../_shared/scoring.ts';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireUser(req);
    const parsed = parseAnswerInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const { roomId, questionId, answer } = parsed.value;

    const { data: question, error } = await db
      .from('questions')
      .select('kind, answer')
      .eq('id', questionId)
      .maybeSingle();
    if (error) throw new HttpError(500, 'internal', error.message);
    if (!question) throw new HttpError(404, 'question_not_found', 'No question with that id.');

    const isCorrect = isCorrectAnswer(question.kind as QuestionKind, answer, question.answer as string);

    const { data, error: rpcError } = await db.rpc('submit_quiz_answer', {
      p_room_id: roomId,
      p_user_id: user.id,
      p_question_id: questionId,
      p_answer: answer,
      p_is_correct: isCorrect,
    });
    if (rpcError) throw new HttpError(500, 'internal', rpcError.message);

    const refusal = answerOutcomeError(data.outcome as AnswerOutcome);
    if (refusal) throw new HttpError(refusal.status, refusal.code, refusal.message);
    return json({ isCorrect: data.isCorrect, points: data.points, score: data.score });
  }),
);
