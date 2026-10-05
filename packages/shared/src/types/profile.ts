import type { Id, Timestamp } from './common';

/**
 * One student's public details. One row per signed-up user, including guests
 * who joined a quiz without an account. The row is created by the database the
 * moment the account is created, so the app never inserts it.
 *
 * Table: profiles. Visible to the student and to anyone who shares a study
 * group with them.
 */
export interface Profile {
  /** Same value as the auth user id. */
  id: Id;
  /** The name other students see. Empty until the student sets one. */
  displayName: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
