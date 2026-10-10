import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { workspaceStyles as s } from '@/components/frame/workspace-page';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { errorMessage } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';

export function CalendarPanel({ ownerId }: { ownerId: string }) {
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    supabase
      .from('calendar_feeds')
      .select('token')
      .eq('user_id', ownerId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setMessage(error.message);
        else setToken(data?.token ?? '');
        setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [ownerId]);
  const url = `${supabaseConfig.url}/functions/v1/calendar-feed?token=${token}`;
  async function create(rotate: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (rotate) {
        const { error } = await supabase.from('calendar_feeds').delete().eq('user_id', ownerId);
        if (error) throw error;
        setToken('');
      }
      const { error } = await supabase.from('calendar_feeds').insert({ user_id: ownerId });
      // Another tab may have created the link first; read that same link.
      if (error && error.code !== '23505') throw error;
      const result = await supabase
        .from('calendar_feeds')
        .select('token')
        .eq('user_id', ownerId)
        .single();
      if (result.error) throw result.error;
      setToken(result.data.token);
      setConfirming(false);
      if (rotate)
        setMessage(
          'New link created. Subscribe again with this link; the old link has stopped working.',
        );
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={s.panel}>
      <AppText variant="title">Your calendar</AppText>
      <AppText>
        Cramrade sends your sessions and exam dates to your calendar. It never reads your calendar.
      </AppText>
      {!token ? (
        <Button busy={busy} onPress={() => void create(false)}>
          Create calendar link
        </Button>
      ) : (
        <>
          <AppText variant="small">
            Anyone with this private link can read your study dates. Share it only with your
            calendar app.
          </AppText>
          <AppText selectable style={{ flexShrink: 1 }}>
            {url}
          </AppText>
          <View style={s.actions}>
            <Button
              disabled={busy}
              onPress={() => {
                void Clipboard.setStringAsync(url)
                  .then(() => setMessage('Calendar link copied.'))
                  .catch(() => setMessage('Could not copy. Select the link above and copy it.'));
              }}
            >
              Copy calendar link
            </Button>
            <Button disabled={busy} variant="quiet" onPress={() => setConfirming(true)}>
              Replace link
            </Button>
          </View>
          {confirming && (
            <View style={s.stack}>
              <AppText>
                Stop the old link working and create a new one? You will need to subscribe again in
                your calendar app.
              </AppText>
              <View style={s.actions}>
                <Button busy={busy} onPress={() => void create(true)}>
                  Replace calendar link
                </Button>
                <Button disabled={busy} variant="quiet" onPress={() => setConfirming(false)}>
                  Keep current link
                </Button>
              </View>
            </View>
          )}
          <AppText bold>Google Calendar</AppText>
          <AppText>
            On a computer, open Google Calendar. Beside Other calendars, choose +, then From URL.
            Paste this link and choose Add calendar.
          </AppText>
          <AppText bold>Apple Calendar</AppText>
          <AppText>
            On Mac, choose File, then New Calendar Subscription. On iPhone, open Calendar, tap
            Calendars, then Add Calendar and Add Subscription Calendar. Paste this link.
          </AppText>
          <AppText variant="small" tone="inkMuted">
            Calendar apps refresh subscriptions on their own schedule. Changes may take a while to
            appear.
          </AppText>
        </>
      )}
      {!!message && <AppText accessibilityLiveRegion="polite">{message}</AppText>}
    </View>
  );
}
