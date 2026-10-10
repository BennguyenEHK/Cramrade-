import { PACES, SESSIONS_PER_DAY, type BusyDay } from '@cramrade/shared';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WorkspacePage, workspaceStyles as s } from '@/components/frame/workspace-page';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { DatePicker } from '@/features/exams/date-picker';
import { parseDate } from '@/features/exams/dates';
import { errorMessage } from '@/lib/functions';
import {
  addBusyDays,
  defaultSettings,
  loadBusyDays,
  loadSettings,
  rebuildPlan,
  removeBusyDays,
  saveSettings,
  type SettingsValues,
} from '@/lib/plan-data';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function SettingsScreen({ ownerId }: { ownerId: string }) {
  const [settings, setSettings] = useState<SettingsValues>(defaultSettings);
  const [days, setDays] = useState<BusyDay[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    Promise.all([loadSettings(ownerId), loadBusyDays(ownerId)])
      .then(([settings, days]) => {
        if (alive) {
          setSettings(settings);
          setDays(days);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ownerId, reload]);
  async function mutate(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    let saved = false;
    try {
      await action();
      saved = true;
      setDays(await loadBusyDays(ownerId));
      await rebuildPlan();
      setMessage('Saved. Your study plan has been rebuilt.');
    } catch (e) {
      setError(
        `${saved ? 'Your changes were saved, but rebuilding the plan failed. Use Rebuild plan on Schedule to retry. ' : ''}${errorMessage(e)}`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function save() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.sessionTime)) {
      setError('Enter the usual session time as HH:MM, using a 24-hour clock.');
      return;
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: settings.timeZone });
    } catch {
      setError('Enter a valid time zone, such as America/Chicago or Europe/London.');
      return;
    }
    void mutate(() => saveSettings(ownerId, settings));
  }
  function add() {
    if (!parseDate(from) || !parseDate(to || from) || (to || from) < from) {
      setError('Choose a real start date and an end date on or after it.');
      return;
    }
    void mutate(async () => {
      await addBusyDays(ownerId, from, to || from, reason);
      setFrom('');
      setTo('');
      setReason('');
    });
  }
  return (
    <WorkspacePage
      title="Study settings"
      intro="Make room for studying around the rest of your week. Changes rebuild your plan from today."
    >
      {loading ? (
        <AppText>Loading settings…</AppText>
      ) : !loaded ? (
        <Button
          onPress={() => {
            setError('');
            setLoading(true);
            setReload((value) => value + 1);
          }}
        >
          Retry loading settings
        </Button>
      ) : (
        <>
          <AppText variant="title">Your usual rhythm</AppText>
          <View style={s.actions}>
            {PACES.map((pace) => (
              <Button
                key={pace}
                disabled={busy}
                variant={settings.pace === pace ? 'primary' : 'quiet'}
                selected={settings.pace === pace}
                onPress={() => setSettings({ ...settings, pace })}
              >{`${pace} · up to ${SESSIONS_PER_DAY[pace]} a day`}</Button>
            ))}
          </View>
          <AppText bold>Weekdays off</AppText>
          <View style={s.actions}>
            {weekdays.map((day, i) => (
              <Button
                key={day}
                disabled={busy}
                variant={settings.daysOff.includes(i) ? 'primary' : 'quiet'}
                selected={settings.daysOff.includes(i)}
                onPress={() =>
                  setSettings({
                    ...settings,
                    daysOff: settings.daysOff.includes(i)
                      ? settings.daysOff.filter((d) => d !== i)
                      : [...settings.daysOff, i].sort(),
                  })
                }
              >{`${day}${settings.daysOff.includes(i) ? ' off' : ''}`}</Button>
            ))}
          </View>
          <TextField
            label="Usual session time"
            hint="24-hour clock, for example 18:00"
            value={settings.sessionTime}
            editable={!busy}
            onChangeText={(sessionTime) => setSettings({ ...settings, sessionTime })}
          />
          <TextField
            label="Time zone"
            hint="For example America/Chicago"
            autoCapitalize="none"
            value={settings.timeZone}
            editable={!busy}
            onChangeText={(timeZone) => setSettings({ ...settings, timeZone: timeZone.trim() })}
          />
          <Button
            disabled={busy}
            variant="quiet"
            onPress={() =>
              setSettings({
                ...settings,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })
            }
          >
            Use this device’s time zone
          </Button>
          <Button busy={busy} onPress={save}>
            Save settings and rebuild
          </Button>
          <View style={s.panel}>
            <AppText variant="title">Busy in the next few days?</AppText>
            <AppText>
              Mark dates when you cannot study. Leave the end date empty for a single day.
            </AppText>
            <DatePicker label="First busy day" value={from} onChange={setFrom} disabled={busy} />
            <DatePicker
              label="Last busy day (optional)"
              value={to}
              onChange={setTo}
              disabled={busy}
            />
            <TextField
              label="Reason (optional)"
              value={reason}
              editable={!busy}
              maxLength={120}
              onChangeText={setReason}
            />
            <Button busy={busy} onPress={add}>
              Add busy days and rebuild
            </Button>
            {days.map((day) => (
              <View key={day.id} style={s.stack}>
                <AppText>
                  {day.fromDate}
                  {day.toDate !== day.fromDate ? ` to ${day.toDate}` : ''}
                  {day.reason ? ` — ${day.reason}` : ''}
                </AppText>
                <Button
                  disabled={busy}
                  variant="quiet"
                  onPress={() => void mutate(() => removeBusyDays(ownerId, day.id))}
                >
                  Make these days available
                </Button>
              </View>
            ))}
          </View>
        </>
      )}
      {!!error && <AppText role="alert">{error}</AppText>}
      {!!message && <AppText accessibilityLiveRegion="polite">{message}</AppText>}
    </WorkspacePage>
  );
}
