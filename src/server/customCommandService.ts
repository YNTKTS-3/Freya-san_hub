import crypto from 'node:crypto';
import { addAuditLog, db } from './db';
import { maskPhoneNumberForGroup } from '../core/gameRules';

export type CustomCommandPermission = 'public' | 'group_admin' | 'owner';
export type CustomCommandBuilderMode = 'visual' | 'script';

export interface CustomCommandBlock {
  type:
    | 'if_args_empty'
    | 'if_equals'
    | 'if_contains'
    | 'reply'
    | 'set_var'
    | 'math'
    | 'reply_text'
    | 'random_choice'
    | 'calculate'
    | 'conditional'
    | 'log_note';
  condition?: string;
  conditionContains?: string;
  value?: string;
  template?: string;
  options?: string[];
  targetVar?: string;
  text?: string;
  elseText?: string;
}

export interface CustomCommandRecord {
  id: string;
  name: string;
  aliases_json: string;
  category: string;
  description: string;
  permission: CustomCommandPermission;
  cooldown_sec: number;
  builder_mode: CustomCommandBuilderMode;
  visual_blocks_json: string;
  script_template: string;
  enabled: number;
  usage_count: number;
  last_tested_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const DISALLOWED_PATTERNS: RegExp[] = [
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bprocess\b/i,
  /\bchild_process\b/i,
  /\bfs\./i,
  /\bglobalThis\b/i,
  /__proto__/i,
  /\bconstructor\b/i,
];

export function validateCustomCommandSyntax(input: {
  name: string;
  aliases?: string[];
  builderMode: CustomCommandBuilderMode;
  visualBlocks?: CustomCommandBlock[];
  blocks?: CustomCommandBlock[];
  scriptTemplate?: string;
  scriptBody?: string;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const cleanName = String(input.name || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(cleanName)) {
    errors.push('Nama command cuma boleh huruf kecil, angka, tanda hubung (-), atau garis bawah (_) sepanjang 2–32 karakter.');
  }

  const reservedNames = new Set(['menu', 'help', 'owner', 'ping', 'streak', 'streakgrup', 'tolive', 'sa', 'stickeraudio', 'redeem']);
  if (reservedNames.has(cleanName)) {
    errors.push(`Nama "${cleanName}" dipakai command inti bawaan, jadi pilih nama unik lain ya.`);
  }

  const blockList = input.visualBlocks ?? input.blocks ?? [];
  const scriptSrc = input.scriptTemplate ?? input.scriptBody ?? '';

  const rawText = input.builderMode === 'script'
    ? String(scriptSrc || '')
    : JSON.stringify(blockList);

  for (const rx of DISALLOWED_PATTERNS) {
    if (rx.test(rawText)) {
      errors.push(`Pola "${rx.source}" nggak diizinkan di sandbox Custom Command demi keamanan server.`);
    }
  }

  if (input.builderMode === 'script') {
    const body = String(scriptSrc || '').trim();
    if (!body) {
      errors.push('Isi script atau template respon nggak boleh kosong ya.');
    }
    if (body.length > 4000) {
      errors.push('Script kepanjangan nih (maksimal 4000 karakter).');
    }
  } else {
    const blocks = Array.isArray(blockList) ? blockList : [];
    if (blocks.length === 0) {
      errors.push('Tambah minimal 1 blok aksi di Visual Builder dulu ya.');
    }
  }

  return { ok: errors.length === 0, errors };
}

function evaluateSafeArithmetic(expr: string): string {
  const cleaned = expr.replace(/[^0-9+\-*/().%\s]/g, '').trim();
  if (!cleaned || cleaned.length > 64) return '0';
  const tokens = cleaned.match(/\d+(?:\.\d+)?|[+\-*/()%]/g);
  if (!tokens) return '0';
  let pos = 0;

  const parseExpr = (): number => {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/' || tokens[pos] === '%')) {
      const op = tokens[pos++];
      const right = parseFactor();
      if (op === '*') left *= right;
      else if (op === '/') left = right === 0 ? 0 : left / right;
      else left = right === 0 ? 0 : left % right;
    }
    return left;
  };

  const parseFactor = (): number => {
    const tok = tokens[pos];
    if (tok === '(') {
      pos++;
      const val = parseExpr();
      if (tokens[pos] === ')') pos++;
      return val;
    }
    if (tok === '-') {
      pos++;
      return -parseFactor();
    }
    pos++;
    const num = Number(tok);
    return Number.isFinite(num) ? num : 0;
  };

  const val = parseExpr();
  return Number.isFinite(val) ? String(Math.round(val * 1000) / 1000) : '0';
}

function applyTemplateVars(template: string, vars: Record<string, string>): string {
  let out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
  });
  out = out.replace(/\{\{\s*random:([^}]+)\s*\}\}/gi, (_m, listRaw) => {
    const choices = String(listRaw).split('|').map((s) => s.trim()).filter(Boolean);
    if (choices.length === 0) return '';
    return choices[Math.floor(Math.random() * choices.length)];
  });
  out = out.replace(/\{\{\s*calc:([^}]+)\s*\}\}/gi, (_m, expr) => {
    const substituted = String(expr).replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : k,
    );
    return evaluateSafeArithmetic(substituted);
  });
  return out;
}

export function evaluateCustomCommandOutput(params: {
  builderMode: CustomCommandBuilderMode;
  blocks: CustomCommandBlock[];
  scriptBody: string;
  ctx: {
    senderName: string;
    senderPhone: string;
    prefix: string;
    rawArgs: string;
    args: string[];
    chatScope: 'private' | 'group';
    groupName?: string;
  };
}): { ok: boolean; output: string; error?: string } {
  const vars: Record<string, string> = {
    sender: params.ctx.senderName || 'Pengguna',
    senderName: params.ctx.senderName || 'Pengguna',
    senderPhoneMasked: maskPhoneNumberForGroup(params.ctx.senderPhone || '6280000000000'),
    prefix: params.ctx.prefix || '.',
    args: params.ctx.rawArgs || '',
    arg0: params.ctx.args[0] || '',
    arg1: params.ctx.args[1] || '',
    arg2: params.ctx.args[2] || '',
    scope: params.ctx.chatScope,
    chatScope: params.ctx.chatScope,
    groupName: params.ctx.groupName || 'Chat Pribadi',
    dateNow: new Date().toISOString().slice(0, 10),
  };

  if (params.builderMode === 'visual') {
    const outLines: string[] = [];
    for (const block of params.blocks) {
      const content = block.text ?? block.template ?? '';
      if (block.type === 'set_var' && block.targetVar) {
        const key = block.targetVar.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
        if (key) vars[key] = applyTemplateVars(block.value || '', vars);
      } else if (block.type === 'math' && block.targetVar) {
        const key = block.targetVar.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
        if (key) {
          vars[key] = evaluateSafeArithmetic(applyTemplateVars(block.value || '0', vars));
        }
      } else if (block.type === 'calculate') {
        const expr = applyTemplateVars(block.template || block.value || vars.args || '0', vars);
        outLines.push(evaluateSafeArithmetic(expr));
      } else if (block.type === 'random_choice') {
        const rawOpts = block.options?.length ? block.options : String(block.template || '').split('|').map((s) => s.trim()).filter(Boolean);
        if (rawOpts.length > 0) {
          outLines.push(applyTemplateVars(rawOpts[Math.floor(Math.random() * rawOpts.length)], vars));
        }
      } else if (block.type === 'if_args_empty') {
        if (!vars.args.trim()) {
          if (content) outLines.push(applyTemplateVars(content, vars));
          return { ok: true, output: outLines.join('\n').trim() || 'Isi argumen setelah command dulu ya.' };
        }
        if (block.elseText) outLines.push(applyTemplateVars(block.elseText, vars));
      } else if (block.type === 'if_equals') {
        const expected = applyTemplateVars(block.condition || '', vars).toLowerCase();
        if (vars.args.trim().toLowerCase() === expected) {
          if (content) outLines.push(applyTemplateVars(content, vars));
        } else if (block.elseText) {
          outLines.push(applyTemplateVars(block.elseText, vars));
        }
      } else if (block.type === 'if_contains' || block.type === 'conditional') {
        const needle = applyTemplateVars(block.conditionContains || block.condition || '', vars).toLowerCase();
        if (needle && vars.args.toLowerCase().includes(needle)) {
          if (content) outLines.push(applyTemplateVars(content, vars));
        } else if (block.elseText) {
          outLines.push(applyTemplateVars(block.elseText, vars));
        }
      } else if ((block.type === 'reply' || block.type === 'reply_text') && content) {
        outLines.push(applyTemplateVars(content, vars));
      }
    }
    const text = outLines.join('\n').trim();
    return { ok: true, output: text || 'Custom command berhasil dijalankan.' };
  }

  // Safe line-oriented script interpreter
  const lines = String(params.scriptBody || '').split(/\r?\n/);
  const outputLines: string[] = [];
  let hasStructuredDirective = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('# ')) continue;

    const setMatch = line.match(/^SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/i);
    if (setMatch) {
      hasStructuredDirective = true;
      vars[setMatch[1]] = applyTemplateVars(setMatch[2], vars);
      continue;
    }

    const mathMatch = line.match(/^MATH\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/i);
    if (mathMatch) {
      hasStructuredDirective = true;
      vars[mathMatch[1]] = evaluateSafeArithmetic(applyTemplateVars(mathMatch[2], vars));
      continue;
    }

    const ifEmptyMatch = line.match(/^IF_EMPTY\s+THEN\s+(.+)$/i);
    if (ifEmptyMatch) {
      hasStructuredDirective = true;
      if (!vars.args.trim()) {
        return { ok: true, output: applyTemplateVars(ifEmptyMatch[1], vars).trim() };
      }
      continue;
    }

    const ifEqMatch = line.match(/^IF\s+args\s*==\s*"([^"]+)"\s+THEN\s+(.+)$/i);
    if (ifEqMatch) {
      hasStructuredDirective = true;
      if (vars.args.trim().toLowerCase() === ifEqMatch[1].trim().toLowerCase()) {
        outputLines.push(applyTemplateVars(ifEqMatch[2], vars));
      }
      continue;
    }

    const replyMatch = line.match(/^REPLY\s+(.+)$/i);
    if (replyMatch) {
      hasStructuredDirective = true;
      outputLines.push(applyTemplateVars(replyMatch[1], vars));
      continue;
    }

    outputLines.push(applyTemplateVars(rawLine, vars));
  }

  const finalOut = hasStructuredDirective
    ? outputLines.join('\n').trim()
    : applyTemplateVars(params.scriptBody, vars).trim();

  return { ok: true, output: finalOut || 'Custom command berhasil dijalankan.' };
}

export function listCustomCommands(): CustomCommandRecord[] {
  const rows = db
    .prepare(`SELECT * FROM custom_commands ORDER BY updated_at DESC, name ASC`)
    .all() as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: r.id || r.name,
    name: r.name,
    aliases_json: r.aliases_json || '[]',
    category: r.category || 'GENERAL',
    description: r.description || '',
    permission: (r.permission as CustomCommandPermission) || 'public',
    cooldown_sec: Number(r.cooldown_sec ?? 3),
    builder_mode: ((r.builder_mode || r.mode) === 'script' ? 'script' : 'visual') as CustomCommandBuilderMode,
    visual_blocks_json: r.visual_blocks_json || '[]',
    script_template: r.script_template || r.script_source || '',
    enabled: Number(r.enabled ?? 1),
    usage_count: Number(r.usage_count ?? 0),
    last_tested_at: r.last_tested_at || null,
    created_by: r.created_by || 'owner',
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function findCustomCommandByNameOrAlias(rawName: string): CustomCommandRecord | undefined {
  const clean = rawName.trim().toLowerCase();
  if (!clean) return undefined;
  const all = listCustomCommands();
  const direct = all.find((c) => c.name.toLowerCase() === clean);
  if (direct) return direct;

  for (const row of all) {
    try {
      const aliases = JSON.parse(row.aliases_json || '[]') as string[];
      if (aliases.some((a) => String(a).trim().toLowerCase() === clean)) {
        return row;
      }
    } catch {
      // ignore invalid alias JSON
    }
  }
  return undefined;
}

export function upsertCustomCommand(
  input: {
    id?: string;
    name: string;
    aliases?: string[];
    category?: string;
    description?: string;
    permission?: CustomCommandPermission;
    cooldown_sec?: number;
    builder_mode?: CustomCommandBuilderMode;
    visual_blocks?: CustomCommandBlock[];
    blocks?: CustomCommandBlock[];
    script_template?: string;
    script_body?: string;
    enabled?: boolean;
    actor?: string;
  },
  actorArg?: string,
): { ok: boolean; command?: CustomCommandRecord; item?: CustomCommandRecord; errors?: string[] } {
  const actor = actorArg || input.actor || 'owner';
  const name = String(input.name || '').trim().toLowerCase();
  const mode: CustomCommandBuilderMode = input.builder_mode === 'script' ? 'script' : 'visual';
  const blocks = Array.isArray(input.visual_blocks) ? input.visual_blocks : Array.isArray(input.blocks) ? input.blocks : [];
  const scriptTemplate = String(input.script_template ?? input.script_body ?? '');

  const check = validateCustomCommandSyntax({
    name,
    builderMode: mode,
    visualBlocks: blocks,
    scriptTemplate,
  });
  if (!check.ok) {
    return { ok: false, errors: check.errors };
  }

  const id = input.id?.trim() || `cc-${crypto.randomBytes(4).toString('hex')}`;
  const perm: CustomCommandPermission =
    input.permission === 'owner' || input.permission === 'group_admin' ? input.permission : 'public';
  const category = String(input.category || 'GENERAL').trim().toUpperCase().slice(0, 24);
  const aliases = Array.isArray(input.aliases)
    ? input.aliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 10)
    : [];

  db.prepare(`
    INSERT INTO custom_commands (
      id, name, aliases_json, category, description, permission, cooldown_sec,
      mode, builder_mode, visual_blocks_json, script_source, script_template, enabled, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      aliases_json = excluded.aliases_json,
      category = excluded.category,
      description = excluded.description,
      permission = excluded.permission,
      cooldown_sec = excluded.cooldown_sec,
      mode = excluded.mode,
      builder_mode = excluded.builder_mode,
      visual_blocks_json = excluded.visual_blocks_json,
      script_source = excluded.script_source,
      script_template = excluded.script_template,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(
    id,
    name,
    JSON.stringify(aliases),
    category,
    String(input.description || `Custom command ${name}`).trim().slice(0, 160),
    perm,
    Math.max(0, Math.min(3600, Math.floor(Number(input.cooldown_sec ?? 3)))),
    mode,
    mode,
    JSON.stringify(blocks),
    scriptTemplate,
    scriptTemplate,
    input.enabled === false ? 0 : 1,
    actor,
  );

  addAuditLog(actor, 'custom_command.upsert', name, { mode, category, perm });
  const saved = listCustomCommands().find((c) => c.name === name);
  return { ok: true, command: saved, item: saved };
}

export function deleteCustomCommand(nameOrId: string, actor = 'owner'): boolean {
  const clean = nameOrId.trim().toLowerCase();
  const res = db
    .prepare(`DELETE FROM custom_commands WHERE LOWER(name) = ? OR id = ?`)
    .run(clean, nameOrId.trim());
  if (res.changes > 0) {
    addAuditLog(actor, 'custom_command.delete', clean);
    return true;
  }
  return false;
}

export function runCustomCommandSandbox(params: {
  name: string;
  builderMode: CustomCommandBuilderMode;
  visualBlocks?: CustomCommandBlock[];
  blocks?: CustomCommandBlock[];
  scriptTemplate?: string;
  scriptBody?: string;
  sampleArgs?: string;
  sampleSenderName?: string;
  senderName?: string;
  senderPhone?: string;
  prefix?: string;
  chatScope?: 'private' | 'group';
}): { ok: boolean; replyText?: string; output?: string; errors?: string[] } {
  const blocks = params.visualBlocks ?? params.blocks ?? [];
  const scriptSrc = params.scriptTemplate ?? params.scriptBody ?? '';
  const check = validateCustomCommandSyntax({
    name: params.name || 'custom_test',
    builderMode: params.builderMode,
    visualBlocks: blocks,
    scriptTemplate: scriptSrc,
  });
  if (!check.ok) {
    return { ok: false, errors: check.errors };
  }
  const rawArgs = String(params.sampleArgs || '').trim();
  const evalRes = evaluateCustomCommandOutput({
    builderMode: params.builderMode,
    blocks,
    scriptBody: scriptSrc,
    ctx: {
      senderName: params.sampleSenderName || params.senderName || 'Owner Sandbox',
      senderPhone: params.senderPhone || '6281200000000',
      prefix: params.prefix || '.',
      rawArgs,
      args: rawArgs ? rawArgs.split(/\s+/) : [],
      chatScope: params.chatScope === 'group' ? 'group' : 'private',
      groupName: params.chatScope === 'group' ? 'Grup Uji Coba' : undefined,
    },
  });

  if (params.name) {
    db.prepare(`UPDATE custom_commands SET last_tested_at = datetime('now') WHERE LOWER(name) = ?`).run(
      params.name.trim().toLowerCase(),
    );
  }

  return { ok: evalRes.ok, replyText: evalRes.output, output: evalRes.output };
}

export function executeSavedCustomCommand(
  cmd: CustomCommandRecord,
  ctx: {
    senderName: string;
    senderPhone: string;
    prefix: string;
    rawArgs: string;
    args: string[];
    chatScope: 'private' | 'group';
    groupName?: string;
  },
): { ok: boolean; replyText: string } {
  let blocks: CustomCommandBlock[] = [];
  try {
    blocks = JSON.parse(cmd.visual_blocks_json || '[]') as CustomCommandBlock[];
  } catch {
    blocks = [];
  }
  const out = evaluateCustomCommandOutput({
    builderMode: cmd.builder_mode,
    blocks,
    scriptBody: cmd.script_template,
    ctx,
  });
  db.prepare(`UPDATE custom_commands SET usage_count = usage_count + 1, updated_at = datetime('now') WHERE LOWER(name) = ?`).run(
    cmd.name.toLowerCase(),
  );
  return { ok: out.ok, replyText: out.output };
}
