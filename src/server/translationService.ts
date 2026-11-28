import crypto from 'node:crypto';
import { addAuditLog, db } from './db';
import { BotLang, findFormalIndonesianViolations, normalizeBotLang } from '../core/botI18n';

export interface EffectiveLanguages {
  menuLang: BotLang;
  aiLang: BotLang;
  source: {
    menu: 'user' | 'group' | 'global';
    ai: 'user' | 'group' | 'global';
  };
}

export function getEffectiveLanguages(params?: { userPhone?: string; groupId?: string }): EffectiveLanguages {
  const globalRows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN ('menu_language', 'ai_language', 'default_language')`)
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(globalRows.map((r) => [r.key, r.value]));

  let menuLang = normalizeBotLang(map.get('menu_language') || map.get('default_language') || 'id');
  let aiLang = normalizeBotLang(map.get('ai_language') || map.get('default_language') || 'id');
  let menuSource: 'user' | 'group' | 'global' = 'global';
  let aiSource: 'user' | 'group' | 'global' = 'global';

  if (params?.groupId) {
    const grp = db
      .prepare(`SELECT menu_language, ai_language FROM groups WHERE id = ?`)
      .get(params.groupId) as { menu_language?: string | null; ai_language?: string | null } | undefined;
    if (grp?.menu_language) {
      menuLang = normalizeBotLang(grp.menu_language);
      menuSource = 'group';
    }
    if (grp?.ai_language) {
      aiLang = normalizeBotLang(grp.ai_language);
      aiSource = 'group';
    }
  }

  if (params?.userPhone) {
    const usr = db
      .prepare(`SELECT menu_language, ai_language, language FROM users WHERE phone = ?`)
      .get(params.userPhone) as { menu_language?: string | null; ai_language?: string | null; language?: string | null } | undefined;
    if (usr?.menu_language) {
      menuLang = normalizeBotLang(usr.menu_language);
      menuSource = 'user';
    } else if (!params.groupId && usr?.language) {
      const legacy = normalizeBotLang(usr.language);
      if (legacy !== 'id' && menuSource === 'global') {
        menuLang = legacy;
      }
    }
    if (usr?.ai_language) {
      aiLang = normalizeBotLang(usr.ai_language);
      aiSource = 'user';
    }
  }

  return {
    menuLang,
    aiLang,
    source: { menu: menuSource, ai: aiSource },
  };
}

export function setGlobalSeparatedLanguage(kind: 'menu' | 'ai', langRaw: string, actor = 'owner'): BotLang {
  const lang = normalizeBotLang(langRaw);
  const key = kind === 'ai' ? 'ai_language' : 'menu_language';
  db.prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 0, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, lang);
  if (kind === 'menu') {
    db.prepare(
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES ('default_language', ?, 0, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(lang);
  }
  addAuditLog(actor, `language.global_${kind}`, lang);
  return lang;
}

export function setUserSeparatedLanguage(userPhone: string, kind: 'menu' | 'ai', langRaw: string | null): BotLang | null {
  const cleanPhone = userPhone.replace(/\D/g, '');
  const val = langRaw ? normalizeBotLang(langRaw) : null;
  if (kind === 'ai') {
    db.prepare(`UPDATE users SET ai_language = ?, updated_at = datetime('now') WHERE phone = ?`).run(val, cleanPhone);
  } else {
    db.prepare(`UPDATE users SET menu_language = ?, updated_at = datetime('now') WHERE phone = ?`).run(val, cleanPhone);
  }
  addAuditLog(cleanPhone, `language.user_${kind}`, val || 'inherit');
  return val;
}

export function setGroupSeparatedLanguage(
  groupId: string,
  kind: 'menu' | 'ai',
  langRaw: string | null,
  actor = 'owner',
): BotLang | null {
  const val = langRaw ? normalizeBotLang(langRaw) : null;
  if (kind === 'ai') {
    db.prepare(`UPDATE groups SET ai_language = ?, updated_at = datetime('now') WHERE id = ?`).run(val, groupId);
  } else {
    db.prepare(`UPDATE groups SET menu_language = ?, updated_at = datetime('now') WHERE id = ?`).run(val, groupId);
  }
  addAuditLog(actor, `language.group_${kind}`, `${groupId}:${val || 'inherit'}`);
  return val;
}

export interface TranslationRecord {
  id: string;
  key: string;
  lang: BotLang;
  namespace: string;
  text: string;
  text_value: string;
  natural_notes: string;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  updated_at: string;
}

function mapTranslationRow(r: any): TranslationRecord {
  return {
    id: r.id,
    key: r.key,
    lang: normalizeBotLang(r.lang),
    namespace: r.namespace || 'bot',
    text: r.text_value,
    text_value: r.text_value,
    natural_notes: r.natural_notes || '',
    review_status: (r.review_status as 'pending' | 'approved' | 'rejected') || 'pending',
    reviewed_by: r.reviewed_by || null,
    updated_at: r.updated_at,
  };
}

export function listTranslations(filters?: { lang?: string; status?: string }): TranslationRecord[] {
  let rows = (db.prepare(`SELECT * FROM translations ORDER BY key ASC, lang ASC`).all() as any[]).map(mapTranslationRow);
  if (filters?.lang && filters.lang !== 'all') {
    rows = rows.filter((r) => r.lang === normalizeBotLang(filters.lang));
  }
  if (filters?.status && filters.status !== 'all') {
    rows = rows.filter((r) => r.review_status === filters.status);
  }
  return rows;
}

export function upsertTranslationEntry(
  input: {
    id?: string;
    key?: string;
    t_key?: string;
    lang: string;
    namespace?: string;
    text?: string;
    text_value?: string;
    natural_notes?: string;
    review_status?: 'pending' | 'approved' | 'rejected';
    actor?: string;
  },
  actorArg?: string,
): { ok: boolean; item?: TranslationRecord; error?: string } {
  const actor = actorArg || input.actor || 'owner';
  const key = String(input.key || input.t_key || '').trim();
  const textValue = String(input.text ?? input.text_value ?? '').trim();
  if (!key || !textValue) {
    return { ok: false, error: 'Key terjemahan dan teks wajib diisi ya.' };
  }
  const lang = normalizeBotLang(input.lang);
  const warnings = lang === 'id' ? findFormalIndonesianViolations(textValue) : [];
  const reviewStatus = input.review_status === 'approved' || input.review_status === 'rejected'
    ? input.review_status
    : 'pending';

  if (reviewStatus === 'approved' && warnings.length > 0) {
    return {
      ok: false,
      error: `Terjemahan bahasa Indonesia masih mengandung kata baku/kaku (${warnings.join(', ')}). Ubah ke bahasa santai dulu sebelum approve ya.`,
    };
  }

  const id = input.id?.trim() || `tr-${crypto.randomBytes(4).toString('hex')}`;
  const notes = input.natural_notes || (warnings.length > 0 ? `Peringatan baku: ${warnings.join(', ')}` : 'Natural nonbaku OK');

  db.prepare(`
    INSERT INTO translations (id, lang, key, text_value, namespace, natural_notes, review_status, reviewed_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(lang, key) DO UPDATE SET
      text_value = excluded.text_value,
      namespace = excluded.namespace,
      natural_notes = excluded.natural_notes,
      review_status = excluded.review_status,
      reviewed_by = excluded.reviewed_by,
      updated_at = datetime('now')
  `).run(
    id,
    lang,
    key,
    textValue,
    String(input.namespace || 'bot').trim(),
    notes,
    reviewStatus,
    reviewStatus === 'pending' ? null : actor,
  );

  addAuditLog(actor, 'translation.upsert', `${key}:${lang}`, { reviewStatus, warningsCount: warnings.length });
  const saved = db.prepare(`SELECT * FROM translations WHERE key = ? AND lang = ?`).get(key, lang);
  return { ok: true, item: mapTranslationRow(saved) };
}

export function reviewTranslationEntry(
  id: string,
  decision: 'approved' | 'rejected',
  actor = 'owner',
  notes?: string,
): { ok: boolean; item?: TranslationRecord; error?: string } {
  const existing = db.prepare(`SELECT * FROM translations WHERE id = ?`).get(id) as any | undefined;
  if (!existing) {
    return { ok: false, error: 'Item terjemahan nggak ketemu.' };
  }
  if (decision === 'approved' && normalizeBotLang(existing.lang) === 'id') {
    const warnings = findFormalIndonesianViolations(existing.text_value);
    if (warnings.length > 0) {
      return {
        ok: false,
        error: `Nggak bisa approve dulu soalnya masih ada kata baku/kaku: ${warnings.join(', ')}`,
      };
    }
  }
  db.prepare(
    `UPDATE translations SET review_status = ?, reviewed_by = ?, natural_notes = COALESCE(?, natural_notes), updated_at = datetime('now') WHERE id = ?`,
  ).run(decision, actor, notes ?? null, id);
  addAuditLog(actor, 'translation.review', id, { decision });
  const updated = db.prepare(`SELECT * FROM translations WHERE id = ?`).get(id);
  return { ok: true, item: mapTranslationRow(updated) };
}
