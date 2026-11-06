'use client';

import { useId, useState } from 'react';
import { presentRoom } from '@/lib/handshake/room';
import type { RoomView } from '@/lib/handshake/room';
import { useT } from '@/lib/i18n/provider';
import { ROOM_SCENARIOS, roomScenario } from '@/lib/mock/room-demo';
import type { RoomScenario } from '@/lib/mock/room-demo';
import { RoomStatusPanel } from './RoomStatusPanel';

/**
 * DEMO ONLY (`/demo/handshake`). Synthetic room snapshots through the REAL
 * room presenter, both phones side by side, so the gated Handshake states can
 * be reviewed before any session service exists. No network, wallet or chain.
 */
export function RoomDemo() {
  const t = useT();
  const r = t.commerce.phase7g.room;
  const selectId = useId();
  const [scenario, setScenario] = useState<RoomScenario>('waiting');
  const data = roomScenario(scenario);
  const views: [RoomView, RoomView] =
    data.kind === 'unavailable'
      ? [data, data]
      : [
          presentRoom({ role: 'merchant', room: data.room, chainTerms: data.merchantTerms, nowNs: data.nowNs, chain: data.chain }),
          presentRoom({ role: 'customer', room: data.room, chainTerms: data.customerTerms, nowNs: data.nowNs, chain: data.chain }),
        ];

  return (
    <section aria-labelledby="room-demo-title" className="mt-8 flex flex-col gap-4" data-testid="room-demo">
      <div className="flex items-center justify-between gap-3">
        <h2 id="room-demo-title" className="text-lg font-semibold">
          {r.previewTitle}
        </h2>
        <span className="shrink-0 rounded-full border border-[var(--tone-caution-border)] px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-[var(--tone-caution-fg)]">
          DEMO
        </span>
      </div>
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{r.previewIntro}</p>
      <label htmlFor={selectId} className="flex flex-col gap-1.5 text-sm font-medium">
        {r.scenario}
        <select
          id={selectId}
          value={scenario}
          onChange={(e) => setScenario(e.target.value as RoomScenario)}
          className="tap-target rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 text-[var(--text-primary)]"
        >
          {ROOM_SCENARIOS.map((s) => (
            <option key={s} value={s}>
              {r.scenarios[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 min-[720px]:grid-cols-2">
        <RoomStatusPanel view={views[0]} label={r.merchantPhone} />
        <RoomStatusPanel view={views[1]} label={r.customerPhone} />
      </div>
      <p className="px-1 text-xs text-[var(--text-muted)]">{r.authority}</p>
    </section>
  );
}
