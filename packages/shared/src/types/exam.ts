import type { DateOnly, Id, Timestamp } from './common';

/** How important the date is. All three get a study plan; the word only changes what the screen shows. */
export const EXAM_KINDS = ['exam', 'quiz', 'competition'] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

/** Where the exam came from: typed by the student, or found in a syllabus and confirmed by the student. */
export const EXAM_SOURCES = ['manual', 'syllabus'] as const;
export type ExamSource = (typeof EXAM_SOURCES)[number];

/**
 * A dated test the student is studying for. The study plan ends on examDate.
 *
 * A date found in a syllabus is never saved here until the student confirms
 * it, so every row in this table is one the student has agreed to.
 *
 * Table: exams. Visible to the owner and, when groupId is set, to that group's
 * members. Only the owner can change or delete it.
 */
export interface Exam {
  id: Id;
  ownerId: Id;
  /** Set when the exam is shared with a study group. Null means private. */
  groupId: Id | null;
  title: string;
  /** The day of the exam, with no time. */
  examDate: DateOnly;
  kind: ExamKind;
  source: ExamSource;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * One subject area inside an exam, for example "Chapter 3: Cell division".
 * Topics come from the syllabus or are typed by the student. Questions and
 * sessions can point at a topic.
 *
 * Table: topics. Same visibility as its exam.
 */
export interface Topic {
  id: Id;
  examId: Id;
  title: string;
  /** Order on the screen, starting at 0. */
  position: number;
  createdAt: Timestamp;
}
