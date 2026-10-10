import type { BusyDay, ScheduleWarning, StudySession, StudySettings } from '@cramrade/shared';
import { supabase } from './supabase';
import { invoke } from './functions';

export type SettingsValues = Pick<StudySettings, 'pace' | 'daysOff' | 'sessionTime' | 'timeZone'>;
export const defaultSettings: SettingsValues = {
  pace: 'normal',
  daysOff: [],
  sessionTime: '18:00',
  timeZone: 'UTC',
};

export async function loadSettings(ownerId: string): Promise<SettingsValues> {
  const { data, error } = await supabase
    .from('study_settings')
    .select('*')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        pace: data.pace,
        daysOff: data.days_off,
        sessionTime: data.session_time.slice(0, 5),
        timeZone: data.time_zone,
      }
    : { ...defaultSettings, daysOff: [] };
}
export async function saveSettings(ownerId: string, settings: SettingsValues) {
  const { error } = await supabase
    .from('study_settings')
    .upsert({
      user_id: ownerId,
      pace: settings.pace,
      days_off: settings.daysOff,
      session_time: settings.sessionTime,
      time_zone: settings.timeZone,
    });
  if (error) throw error;
}
export async function loadBusyDays(ownerId: string): Promise<BusyDay[]> {
  const { data, error } = await supabase
    .from('busy_days')
    .select('*')
    .eq('user_id', ownerId)
    .order('from_date');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    fromDate: row.from_date,
    toDate: row.to_date,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
export async function addBusyDays(
  ownerId: string,
  fromDate: string,
  toDate: string,
  reason: string,
) {
  const { error } = await supabase
    .from('busy_days')
    .insert({
      user_id: ownerId,
      from_date: fromDate,
      to_date: toDate,
      reason: reason.trim() || null,
    });
  if (error) throw error;
}
export async function removeBusyDays(ownerId: string, id: string) {
  const { error } = await supabase.from('busy_days').delete().eq('user_id', ownerId).eq('id', id);
  if (error) throw error;
}
export async function loadPlan(ownerId: string): Promise<StudySession[]> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select('*')
    .eq('owner_id', ownerId)
    .order('scheduled_for');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    examId: row.exam_id,
    scheduledFor: row.scheduled_for,
    status: row.status,
    isFinalPass: row.is_final_pass,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
export function rebuildPlan() {
  return invoke<{ warnings: ScheduleWarning[] }>('build-schedule', {});
}
export async function setSessionStatus(
  ownerId: string,
  id: string,
  status: StudySession['status'],
) {
  const { data, error } = await supabase
    .from('study_sessions')
    .update({ status })
    .eq('owner_id', ownerId)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('This session changed. Refresh your schedule.');
}

export function calendarDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
