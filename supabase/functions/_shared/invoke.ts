// Start another function without waiting for its answer ("fire and forget"),
// for example extract-text starting make-questions.
//
// The call carries the service-role key, which is a JWT while the project's
// legacy API keys are on, so it passes verify_jwt. The called function
// recognises it with isServiceCall() from auth.ts. If the legacy keys are
// ever switched off, the called function needs verify_jwt = false and its own
// key check.

import { serviceRoleKey } from './db.ts';

/** Supabase's runtime global: keeps the worker alive for work after the answer is sent. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

/** POST body to /functions/v1/<name>. Failures are logged, never thrown. */
export function invokeInBackground(name: string, body: unknown): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`;
  const call = fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const text = await res.text();
      if (!res.ok) console.error(`${name} answered ${res.status}: ${text.slice(0, 300)}`);
    })
    .catch((e) => console.error(`${name} could not be called`, e));
  // Keep this worker alive until the call is done, after our own answer is sent.
  EdgeRuntime.waitUntil(call);
}
