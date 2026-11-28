import { GoogleGenAI } from '@google/genai';
import { addAuditLog, addSystemLog, db } from './db';
import { BotLang, normalizeBotLang } from '../core/botI18n';
import { recordApiVaultUsage, resolveVaultKeyForRuntime } from './apiVaultService';
import { getEffectiveLanguages } from './translationService';

function getGeminiClient(): { client: GoogleGenAI; source: 'env' | 'vault' } | null {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey && envKey !== 'MY_GEMINI_API_KEY') {
    return {
      client: new GoogleGenAI({
        apiKey: envKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }),
      source: 'env',
    };
  }
  const vaultEntry = resolveVaultKeyForRuntime('gemini', 'ai_agents');
  if (vaultEntry.ok && vaultEntry.apiKey) {
    return {
      client: new GoogleGenAI({
        apiKey: vaultEntry.apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }),
      source: 'vault',
    };
  }
  return null;
}

function buildLanguageInstruction(lang: BotLang): string {
  if (lang === 'en') {
    return 'Respond in friendly, natural conversational English. Keep explanations concise and accurate.';
  }
  if (lang === 'ja') {
    return '自然な日本語（親しみやすい丁寧語・カジュアルトーン）で分かりやすく正確に回答してください。';
  }
  return 'Jawab akurat pakai bahasa Indonesia santai sehari-hari (nonbaku) yang natural, ramah, dan gampang dipahami. Jangan kaku.';
}

export interface AiQueryResult {
  ok: boolean;
  provider: string;
  model: string;
  language: BotLang;
  text: string;
  citations: Array<{ title: string; url: string }>;
  latencyMs: number;
  error?: string;
}

export async function runNexaraAiQuery(params: {
  prompt: string;
  userPhone?: string;
  groupId?: string;
  modelName?: string;
  aiLanguage?: BotLang;
  useWebGrounding?: boolean;
  systemPromptOverride?: string;
}): Promise<AiQueryResult> {
  const started = Date.now();
  const effectiveLang =
    params.aiLanguage ||
    getEffectiveLanguages({ userPhone: params.userPhone, groupId: params.groupId }).aiLang;

  const providerRow = db
    .prepare("SELECT * FROM ai_providers WHERE id = 'gemini-nexara'")
    .get() as { system_prompt: string; enabled: number } | undefined;

  if (providerRow && !providerRow.enabled) {
    return {
      ok: false,
      provider: 'gemini-nexara',
      model: params.modelName || 'gemini-4-hydrogen',
      language: effectiveLang,
      text: '',
      citations: [],
      latencyMs: Date.now() - started,
      error: 'Provider Nexara (Gemini) lagi dimatiin sementara sama Owner.',
    };
  }

  const clientWrap = getGeminiClient();
  const model = params.modelName || 'gemini-4-hydrogen';

  if (!clientWrap) {
    db.prepare(
      `INSERT INTO ai_usage (provider_id, model_name, user_phone, prompt_preview, tokens_est, latency_ms, success, error_message)
       VALUES ('gemini-nexara', ?, ?, ?, 0, ?, 0, 'GEMINI_API_KEY not configured')`,
    ).run(model, params.userPhone ?? null, params.prompt.slice(0, 120), Date.now() - started);

    return {
      ok: false,
      provider: 'gemini-nexara',
      model,
      language: effectiveLang,
      text: '',
      citations: [],
      latencyMs: Date.now() - started,
      error: 'GEMINI_API_KEY belum diatur di panel Secrets server (atau Central API Vault) nih. Tambahin dulu biar AI bisa jawab ya.',
    };
  }

  try {
    const baseInstruction =
      params.systemPromptOverride ||
      providerRow?.system_prompt ||
      'Kamu adalah Freya-san AI (Nexara).';
    const systemInstruction = `${baseInstruction}\n${buildLanguageInstruction(effectiveLang)}`;

    const response = await clientWrap.client.models.generateContent({
      model,
      contents: params.prompt,
      config: {
        systemInstruction,
        ...(params.useWebGrounding ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

    const text = response.text ?? '';
    const citations: Array<{ title: string; url: string }> = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        citations.push({
          title: chunk.web.title || chunk.web.uri,
          url: chunk.web.uri,
        });
      }
    }

    const latencyMs = Date.now() - started;
    const tokensEst = Math.ceil((params.prompt.length + text.length) / 4);
    db.prepare(
      `INSERT INTO ai_usage (provider_id, model_name, user_phone, prompt_preview, tokens_est, latency_ms, success)
       VALUES ('gemini-nexara', ?, ?, ?, ?, ?, 1)`,
    ).run(model, params.userPhone ?? null, params.prompt.slice(0, 120), tokensEst, latencyMs);
    if (clientWrap.source === 'vault') {
      recordApiVaultUsage('gemini', true);
    }

    return {
      ok: true,
      provider: 'gemini-nexara',
      model,
      language: effectiveLang,
      text,
      citations,
      latencyMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Gemini API error';
    const latencyMs = Date.now() - started;
    db.prepare(
      `INSERT INTO ai_usage (provider_id, model_name, user_phone, prompt_preview, tokens_est, latency_ms, success, error_message)
       VALUES ('gemini-nexara', ?, ?, ?, 0, ?, 0, ?)`,
    ).run(model, params.userPhone ?? null, params.prompt.slice(0, 120), latencyMs, message);
    if (clientWrap.source === 'vault') {
      recordApiVaultUsage('gemini', false, message);
    }

    addSystemLog('error', 'aiService', `Gemini call failed: ${message}`);

    return {
      ok: false,
      provider: 'gemini-nexara',
      model,
      language: effectiveLang,
      text: '',
      citations: [],
      latencyMs,
      error: message,
    };
  }
}

const AI_AGENT_FORBIDDEN_PATTERNS: RegExp[] = [
  /process\.env/i,
  /creds\.json/i,
  /owner_passcode/i,
  /api_keys_vault/i,
  /\bread\s+env\b/i,
  /\bAPI\s+key\b/i,
  /\b(rm\s+-rf|chmod|chown|curl\s+|wget\s+|bash\s+-c|sh\s+-c|exec\s*\()/i,
  /\b(SELECT|DROP|DELETE|UPDATE|INSERT)\s+.+\bFROM\b/i,
];

export async function runAiAgentAction(params: {
  agentId: string;
  prompt: string;
  actorRole: 'user' | 'group_admin' | 'owner';
  actorPhone?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  lang?: string;
}): Promise<{ ok: boolean; agentName: string; text?: string; reply: string; denied?: boolean; error?: string }> {
  const agent =
    (db
      .prepare(`SELECT id, name, role, COALESCE(risk_level, 'low') AS risk_level, COALESCE(enabled, 1) AS enabled FROM ai_agents WHERE id = ?`)
      .get(params.agentId) as
      | { id: string; name: string; role: string; risk_level: string; enabled: number }
      | undefined) ||
    (params.agentId === 'coordinator'
      ? { id: 'coordinator', name: 'Operations & Coordinator Agent', role: 'Task Coordinator', risk_level: 'low', enabled: 1 }
      : undefined);

  if (!agent) {
    return { ok: false, agentName: params.agentId, reply: '', error: 'Agent AI nggak ketemu.' };
  }
  if (!agent.enabled) {
    return {
      ok: false,
      agentName: agent.name,
      reply: `Agent *${agent.name}* lagi dimatiin sementara sama Owner.`,
      denied: true,
    };
  }
  const effectiveRisk = params.riskLevel || agent.risk_level;
  if (effectiveRisk === 'high' && params.actorRole !== 'owner') {
    addAuditLog(params.actorPhone || 'user', 'ai_agent.denied_role', agent.id, { role: params.actorRole, risk: effectiveRisk });
    return {
      ok: false,
      agentName: agent.name,
      reply: `Aksi agent *${agent.name}* berisiko tinggi dan khusus buat Owner aja ya.`,
      error: `Aksi agent *${agent.name}* berisiko tinggi dan khusus buat Owner aja ya.`,
      denied: true,
    };
  }

  for (const rx of AI_AGENT_FORBIDDEN_PATTERNS) {
    if (rx.test(params.prompt)) {
      addAuditLog(params.actorPhone || params.actorRole, 'ai_agent.guardrail_blocked', agent.id, {
        pattern: rx.source,
      });
      const deniedMsg = 'Permintaan itu ditolak otomatis oleh pagar keamanan Agent AI (nggak boleh akses terminal, file kredensial, atau query database langsung).';
      return {
        ok: false,
        agentName: agent.name,
        reply: deniedMsg,
        error: deniedMsg,
        denied: true,
      };
    }
  }

  const scoped = await runNexaraAiQuery({
    prompt: `[Agent: ${agent.name} | Role: ${agent.role}]\n${params.prompt}`,
    userPhone: params.actorPhone,
    aiLanguage: normalizeBotLang(params.lang || getEffectiveLanguages({ userPhone: params.actorPhone }).aiLang),
    systemPromptOverride: `Kamu menjalankan tugas sebagai agent "${agent.name}" (${agent.role}). Kamu TIDAK punya akses ke shell, file rahasia, atau database langsung.`,
  });

  if (!scoped.ok) {
    return { ok: false, agentName: agent.name, reply: '', error: scoped.error };
  }
  return { ok: true, agentName: agent.name, text: scoped.text, reply: scoped.text };
}

export async function researchOfficial48GroupSource(params: {
  query: string;
  groupId: string;
  requestedBy: string;
}): Promise<{ ok: boolean; verificationId?: string; summary: string; citations: Array<{ title: string; url: string }>; error?: string }> {
  const prompt = `Lakukan riset fakta resmi 48Group untuk grup "${params.groupId.toUpperCase()}" mengenai: "${params.query}".
Aturan ketat:
1. Prioritaskan situs resmi (seperti jkt48.com, akb48.co.jp, bnk48.com, mnl48.ph, dll.).
2. Jangan ngarang nama member, generasi, tanggal debut/kelulusan, atau setlist.
3. Kalau infonya belum ketemu di sumber resmi, tulis jelas "belum terverifikasi".
4. Balikin ringkasan fakta pakai bahasa Indonesia santai yang jelas dan gampang dibaca.`;

  const res = await runNexaraAiQuery({
    prompt,
    userPhone: params.requestedBy,
    useWebGrounding: true,
  });

  if (!res.ok) {
    return {
      ok: false,
      summary: '',
      citations: [],
      error: res.error,
    };
  }

  const primarySource = res.citations[0] ?? {
    title: 'Belum ada tautan sumber resmi terlampir',
    url: 'https://jkt48.com/',
  };
  const verificationId = `ver-${Date.now()}`;
  const hasOfficialCitation = res.citations.length > 0;

  db.prepare(`
    INSERT INTO forty_eight_verifications (
      id, entity_type, entity_id, entity_name, group_id, proposed_payload_json,
      source_title, source_url, info_status, approval_status, retrieved_at
    ) VALUES (?, 'research_note', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    verificationId,
    `res-${Date.now()}`,
    params.query.slice(0, 120),
    params.groupId,
    JSON.stringify({
      summary: res.text,
      citations: res.citations,
    }),
    primarySource.title,
    primarySource.url,
    hasOfficialCitation ? 'pending_review' : 'unconfirmed',
    new Date().toISOString(),
  );

  // Also record AI agent approval proposal for traceability
  db.prepare(`
    INSERT INTO ai_agent_approvals (id, agent_id, action_title, payload_json, risk_level, status)
    VALUES (?, 'agent-researcher-48', ?, ?, 'low', 'pending')
  `).run(
    `apr-${Date.now()}`,
    `Publikasi riset 48Group: ${params.query.slice(0, 80)}`,
    JSON.stringify({ verificationId, groupId: params.groupId, citations: res.citations }),
  );

  addAuditLog(params.requestedBy, '48group.research.queued', verificationId, {
    query: params.query,
    citations: res.citations.length,
  });

  return {
    ok: true,
    verificationId,
    summary: res.text,
    citations: res.citations,
  };
}
