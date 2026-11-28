import crypto from 'node:crypto';
import net from 'node:net';
import { addAuditLog, addSystemLog, db } from './db';
import { expireStaleSessions } from './gameEngine';

export interface AutomationActionConfig {
  type:
    | 'health_snapshot'
    | 'expire_game_sessions'
    | 'streak_daily_check'
    | 'webhook_notify'
    | 'webhook'
    | 'system_log_note'
    | 'system_note'
    | 'cleanup_logs';
  targetUrl?: string;
  url?: string;
  note?: string;
}

export interface AutomationRecord {
  id: string;
  name: string;
  trigger_type: string;
  cron_expr: string;
  condition_expr: string;
  action_json: string;
  max_retries: number;
  enabled: number;
  last_run_at: string | null;
  last_error: string | null;
  run_count: number;
  status: string;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const low = hostname.toLowerCase();
  if (low === 'localhost' || low === '127.0.0.1' || low === '::1' || low === '0.0.0.0') return true;
  if (low.endsWith('.local') || low.endsWith('.internal')) return true;
  if (net.isIPv4(low)) {
    const [a, b] = low.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function validateSafeWebhookUrl(rawUrl: string): { ok: boolean; error?: string } {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { ok: false, error: 'URL webhook cuma boleh pakai protokol http:// atau https://.' };
    }
    if (isPrivateOrLocalHostname(u.hostname)) {
      return { ok: false, error: 'Alamat lokal/privat/metadata nggak diizinkan sebagai tujuan webhook.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Format URL webhook nggak valid.' };
  }
}

export function listAutomationsWithHistory() {
  const automations = db.prepare(`SELECT * FROM automations ORDER BY name ASC`).all() as AutomationRecord[];
  const history = db.prepare(`SELECT * FROM scheduled_tasks ORDER BY id DESC LIMIT 40`).all();
  return { automations, history };
}

export function upsertAutomation(
  input: {
    id?: string;
    name: string;
    trigger_type?: string;
    cron_expr?: string;
    condition_expr?: string;
    action?: AutomationActionConfig;
    max_retries?: number;
    enabled?: boolean;
    actor?: string;
  },
  actorArg?: string,
): { ok: boolean; automation?: AutomationRecord; item?: AutomationRecord; error?: string } {
  const actor = actorArg || input.actor || 'owner';
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) {
    return { ok: false, error: 'Nama workflow otomasi wajib diisi ya.' };
  }
  const action: AutomationActionConfig = input.action || { type: 'health_snapshot' };
  const resolvedUrl = action.targetUrl || action.url;
  if (action.type === 'webhook_notify' || action.type === 'webhook') {
    const check = validateSafeWebhookUrl(String(resolvedUrl || ''));
    if (!check.ok) return { ok: false, error: check.error };
  }

  const id = input.id?.trim() || `auto-${crypto.randomBytes(4).toString('hex')}`;
  const enabled = input.enabled === false ? 0 : 1;
  const maxRetries = Math.max(1, Math.min(5, Math.floor(Number(input.max_retries ?? 2))));

  db.prepare(`
    INSERT INTO automations (
      id, name, trigger_type, cron_expr, condition_expr, action_json, max_retries, enabled, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      trigger_type = excluded.trigger_type,
      cron_expr = excluded.cron_expr,
      condition_expr = excluded.condition_expr,
      action_json = excluded.action_json,
      max_retries = excluded.max_retries,
      enabled = excluded.enabled,
      status = excluded.status
  `).run(
    id,
    name,
    String(input.trigger_type || 'cron').trim().slice(0, 32),
    String(input.cron_expr || '0 * * * *').trim().slice(0, 48),
    String(input.condition_expr || 'always').trim().slice(0, 48),
    JSON.stringify(action),
    maxRetries,
    enabled,
    enabled ? 'scheduled' : 'paused',
  );

  addAuditLog(actor, 'automation.upsert', id, { name, actionType: action.type });
  const saved = db.prepare(`SELECT * FROM automations WHERE id = ?`).get(id) as AutomationRecord;
  return { ok: true, automation: saved, item: saved };
}

function evaluateAutomationCondition(expr: string): { passed: boolean; reason: string } {
  const clean = String(expr || 'always').trim().toLowerCase();
  if (clean === 'always' || !clean) {
    return { passed: true, reason: 'Kondisi selalu aktif terpenuhi' };
  }
  if (clean === 'if_maintenance_off') {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'maintenance_mode'`).get() as { value: string } | undefined;
    const ok = row?.value !== 'true';
    return { passed: ok, reason: ok ? 'Mode maintenance sedang OFF' : 'Dilewati karena maintenance mode sedang ON' };
  }
  if (clean === 'if_wa_connected') {
    const row = db.prepare(`SELECT status FROM bot_sessions WHERE id = 'primary'`).get() as { status: string } | undefined;
    const ok = row?.status === 'connected';
    return { passed: ok, reason: ok ? 'WhatsApp Engine sedang connected' : 'Dilewati karena WhatsApp Engine belum connected' };
  }
  return { passed: true, reason: 'Kondisi default terpenuhi' };
}

export async function runAutomationWithRetry(
  automationId: string,
  actor = 'owner',
): Promise<{ ok: boolean; status: 'completed' | 'skipped' | 'failed'; summary: string; attempts: number }> {
  const row = db.prepare(`SELECT * FROM automations WHERE id = ?`).get(automationId) as AutomationRecord | undefined;
  if (!row) {
    return { ok: false, status: 'failed', summary: 'Workflow otomasi nggak ketemu.', attempts: 0 };
  }

  const cond = evaluateAutomationCondition(row.condition_expr || 'always');
  if (!cond.passed) {
    db.prepare(`UPDATE automations SET last_run_at = datetime('now'), status = 'scheduled' WHERE id = ?`).run(row.id);
    db.prepare(
      `INSERT INTO scheduled_tasks (automation_id, status, attempt_count, output_summary, finished_at) VALUES (?, 'skipped', 0, ?, datetime('now'))`,
    ).run(row.id, cond.reason);
    return { ok: true, status: 'skipped', summary: cond.reason, attempts: 0 };
  }

  let action: AutomationActionConfig = { type: 'health_snapshot' };
  try {
    action = JSON.parse(row.action_json || '{}') as AutomationActionConfig;
  } catch {
    action = { type: 'health_snapshot' };
  }

  const maxAttempts = Math.max(1, Math.min(5, row.max_retries || 2));
  let attempts = 0;
  let lastError = '';
  const webhookUrl = action.targetUrl || action.url;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      let summary = '';
      if (action.type === 'expire_game_sessions' || action.type === 'cleanup_logs') {
        expireStaleSessions();
        const delLogs = db.prepare(`DELETE FROM logs WHERE datetime(created_at) < datetime('now', '-30 days')`).run();
        summary = `Pembersihan sesi kedaluwarsa & ${delLogs.changes} log lama selesai (percobaan #${attempts}).`;
      } else if (action.type === 'streak_daily_check') {
        const pairCount = (db.prepare(`SELECT COUNT(*) AS c FROM pair_streaks WHERE status = 'active'`).get() as { c: number }).c;
        const grpCount = (db.prepare(`SELECT COUNT(*) AS c FROM group_streaks WHERE enabled = 1`).get() as { c: number }).c;
        summary = `Audit harian streak selesai: ${pairCount} streak pasangan aktif, ${grpCount} grup aktif.`;
      } else if ((action.type === 'webhook_notify' || action.type === 'webhook') && webhookUrl) {
        const check = validateSafeWebhookUrl(webhookUrl);
        if (!check.ok) throw new Error(check.error || 'URL webhook nggak valid');
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: 'Freya-san Hub',
            version: '5.0',
            automationId: row.id,
            automationName: row.name,
            note: action.note || '',
            ts: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) throw new Error(`Webhook HTTP ${resp.status}`);
        summary = `Webhook terkirim (HTTP ${resp.status}) dalam ${attempts}x percobaan.`;
      } else if (action.type === 'system_log_note' || action.type === 'system_note') {
        addSystemLog('info', 'automation', action.note || `Workflow ${row.name} berjalan`);
        summary = `Catatan sistem ditulis (${action.note || row.name}).`;
      } else {
        const cmdTotal = (db.prepare(`SELECT COUNT(*) AS c FROM commands`).get() as { c: number }).c;
        const usrTotal = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
        summary = `Health snapshot OK: ${cmdTotal} command terdaftar, ${usrTotal} user aktif.`;
      }

      db.prepare(
        `UPDATE automations SET run_count = run_count + 1, last_run_at = datetime('now'), last_error = NULL, status = ? WHERE id = ?`,
      ).run(row.enabled ? 'scheduled' : 'paused', row.id);
      db.prepare(
        `INSERT INTO scheduled_tasks (automation_id, status, attempt_count, output_summary, finished_at) VALUES (?, 'completed', ?, ?, datetime('now'))`,
      ).run(row.id, attempts, summary);
      addAuditLog(actor, 'automation.run_now', row.id, { status: 'completed', attempts });
      return { ok: true, status: 'completed', summary, attempts };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Eksekusi gagal';
    }
  }

  db.prepare(
    `UPDATE automations SET run_count = run_count + 1, last_run_at = datetime('now'), last_error = ?, status = 'error' WHERE id = ?`,
  ).run(lastError, row.id);
  db.prepare(
    `INSERT INTO scheduled_tasks (automation_id, status, attempt_count, output_summary, finished_at) VALUES (?, 'failed', ?, ?, datetime('now'))`,
  ).run(row.id, attempts, `Gagal setelah ${attempts}x percobaan: ${lastError}`);
  addSystemLog('error', 'automation', `Workflow ${row.name} gagal: ${lastError}`);
  addAuditLog(actor, 'automation.run_failed', row.id, { attempts, lastError });
  return { ok: false, status: 'failed', summary: lastError, attempts };
}
