import type { Id, Timestamp } from './common';

/** What a member may do in a group. The owner created it and is the only one who can change or delete it. */
export type GroupRole = 'owner' | 'member';

/**
 * A study group: a few classmates who share exams, notes and quizzes.
 *
 * Table: groups. Visible to its members. Only the owner can rename or delete it.
 */
export interface Group {
  id: Id;
  name: string;
  /** The student who created the group. */
  ownerId: Id;
  /**
   * Short code (6 letters and digits) the owner shares with classmates.
   * Anyone who types it joins the group through the join_group() database
   * function. Made by the database, never by the app.
   */
  joinCode: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * One student's membership of one group. The owner's row is added by the
 * database when the group is created. Other rows come from join_group().
 *
 * Table: group_members. Visible to members of that group.
 */
export interface GroupMember {
  groupId: Id;
  userId: Id;
  role: GroupRole;
  joinedAt: Timestamp;
}
