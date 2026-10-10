import type { Chunk, Note, NoteSource, NoteStatus } from '@cramrade/shared';
import { supabase } from '@/lib/supabase';

type NoteRow = {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
  source: NoteSource;
  original_filename: string | null;
  status: NoteStatus;
  created_at: string;
  updated_at: string;
};
type ChunkRow = {
  id: string;
  note_id: string;
  position: number;
  text: string;
  created_at: string;
};

export function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    ownerId: row.owner_id,
    groupId: row.group_id,
    title: row.title,
    source: row.source,
    originalFilename: row.original_filename,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listNotes(ownerId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as NoteRow[]).map(mapNote);
}

export async function readChunks(noteId: string): Promise<Chunk[]> {
  const { data, error } = await supabase
    .from('chunks')
    .select('*')
    .eq('note_id', noteId)
    .order('position');
  if (error) throw error;
  return (data as ChunkRow[]).map((row) => ({
    id: row.id,
    noteId: row.note_id,
    position: row.position,
    text: row.text,
    createdAt: row.created_at,
  }));
}
