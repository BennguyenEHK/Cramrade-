import type { Exam, ExamKind, ExamSource } from '@cramrade/shared';
import { supabase } from '@/lib/supabase';

export type ExamRow = {
  id: string; owner_id: string; group_id: string | null; title: string;
  exam_date: string; kind: ExamKind; source: ExamSource; created_at: string; updated_at: string;
};

export function mapExam(row: ExamRow): Exam {
  return { id: row.id, ownerId: row.owner_id, groupId: row.group_id, title: row.title,
    examDate: row.exam_date, kind: row.kind, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listExams(ownerId: string): Promise<Exam[]> {
  const { data, error } = await supabase.from('exams').select('*').eq('owner_id', ownerId).order('exam_date').order('created_at');
  if (error) throw error;
  return (data as ExamRow[]).map(mapExam);
}

export async function saveExam(ownerId: string, values: { title: string; examDate: string; kind: ExamKind }, id?: string): Promise<Exam> {
  const row = { title: values.title.trim(), exam_date: values.examDate, kind: values.kind };
  const query = id ? supabase.from('exams').update(row).eq('id', id).eq('owner_id', ownerId)
    : supabase.from('exams').insert({ ...row, owner_id: ownerId, source: 'manual' });
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return mapExam(data as ExamRow);
}

export async function deleteExam(ownerId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from('exams').delete().eq('id', id).eq('owner_id', ownerId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('This exam is no longer available. Refresh your exams.');
}
