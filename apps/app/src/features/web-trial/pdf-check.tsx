import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { TrialButton } from './trial-button';

/**
 * Where the trial sends the picked file. Nothing listens at the default address
 * on the dev server or on Expo hosting, so a normal run gets "not found" back,
 * which still proves the browser sent the file. To see the bytes arrive, run a
 * receiver and open the page with ?receiver=<its address>.
 */
function uploadAddress() {
  const search = globalThis.location?.search ?? '';
  return new URLSearchParams(search).get('receiver') ?? '/trial-upload';
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string }
  | {
      kind: 'done';
      name: string;
      size: number;
      startsLikePdf: boolean;
      sendStatus: number | null;
      sendAnswer: string;
    };

/** B1 trial, part one: can Expo web pick a PDF, read it, and send it to a server? */
export function PdfCheck() {
  const { colors } = useTheme();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  async function pickAndSend() {
    setOutcome({ kind: 'working' });
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        base64: false,
        multiple: false,
      });
      if (result.canceled) {
        setOutcome({ kind: 'idle' });
        return;
      }

      const asset = result.assets[0];
      const file = asset.file;
      if (!file) {
        setOutcome({ kind: 'error', message: 'No file came back. This check runs in a browser only.' });
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const head = String.fromCharCode(...bytes.slice(0, 5));

      const form = new FormData();
      form.append('file', file, file.name);
      let sendStatus: number | null = null;
      let sendAnswer = '';
      try {
        const response = await fetch(uploadAddress(), { method: 'POST', body: form });
        sendStatus = response.status;
        sendAnswer = response.ok ? (await response.text()).slice(0, 200) : 'No receiver yet.';
      } catch (error) {
        sendAnswer = `The browser could not send it: ${String(error)}`;
      }

      setOutcome({
        kind: 'done',
        name: asset.name,
        size: bytes.byteLength,
        startsLikePdf: head === '%PDF-',
        sendStatus,
        sendAnswer,
      });
    } catch (error) {
      setOutcome({ kind: 'error', message: String(error) });
    }
  }

  return (
    <View style={styles.block}>
      <AppText variant="title">1. Upload a PDF</AppText>
      <AppText tone="inkMuted" style={styles.prose}>
        Pick a PDF from this computer. The page reads its bytes, checks that it starts like a PDF,
        and sends it to a web address the way a real upload would.
      </AppText>
      <TrialButton
        label={outcome.kind === 'working' ? 'Reading the file' : 'Pick a PDF'}
        onPress={pickAndSend}
        disabled={outcome.kind === 'working'}
      />

      {outcome.kind === 'error' && (
        <AppText role="alert" bold>
          {outcome.message}
        </AppText>
      )}

      {outcome.kind === 'done' && (
        <View
          testID="pdf-result"
          style={[styles.result, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <AppText>File: {outcome.name}</AppText>
          <AppText testID="pdf-size">Bytes read: {outcome.size}</AppText>
          <AppText testID="pdf-header">
            Starts like a PDF: {outcome.startsLikePdf ? 'yes' : 'no'}
          </AppText>
          <AppText testID="pdf-sent">
            Sent to the server: {outcome.sendStatus === null ? 'no' : `yes, answer ${outcome.sendStatus}`}
          </AppText>
          <AppText testID="pdf-answer" tone="inkMuted">
            {outcome.sendAnswer}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.md,
  },
  prose: {
    maxWidth: Layout.proseMaxWidth,
  },
  result: {
    gap: Spacing.xxs,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.panel,
    maxWidth: Layout.proseMaxWidth,
  },
});
