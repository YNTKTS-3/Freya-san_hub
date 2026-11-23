import { GoogleGenAI } from '@google/genai';
import { addAuditLog, addSystemLog, db } from './db';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface AiQueryResult {
  ok: boolean;
  provider: string;
  model: string;
  text: string;
  citations: Array<{ title: string; url: string }>;
  latencyMs: number;
  error?: string;
}

export async function runNexaraAiQuery(params: {
  prompt: string;
  userPhone?: string;
  modelName?: string;
  useWebGrounding?: boolean;
  systemPromptOverride?: string;
}): Promise<AiQueryResult> {
  const started = Date.now();
  const providerRow = db
    .prepare("SELECT * FROM ai_providers WHERE id = 'gemini-nexara'")
    .get() as { system_prompt: string; enabled: number } | undefined;

  if (providerRow && !providerRow.enabled) {
    return {
      ok: false,
      provider: 'gemini-nexara',
      model: params.modelName || 'gemini-4-hydrogen',
      text: '',
      citations: [],
      latencyMs: Date.now() - started,
      error: 'Provider Nexara (Gemini) sedang dinonaktifkan oleh owner.',
    };
  }

  const client = getGeminiClient();
  const model = params.modelName || 'gemini-4-hydrogen';

  if (!client) {
    db.prepare(
      `INSERT INTO ai_usage (provider_id, model_name, user_phone, prompt_preview, tokens_est, latency_ms, success, error_message)
       VALUES ('gemini-nexara', ?, ?, ?, 0, ?, 0, 'GEMINI_API_KEY not configured')`,
    ).run(model, params.userPhone ?? null, params.prompt.slice(0, 120), Date.now() - started);

    return {
      ok: false,
      provider: 'gemini-nexara',
      model,
      text: '',
      citations: [],
      latencyMs: Date.now() - started,
      error: 'GEMINI_API_KEY belum dikonfigurasi pada Secrets server. Silakan atur GEMINI_API_KEY di panel Secrets AI Studio.',
    };
  }

  try {
    const systemInstruction =
      params.systemPromptOverride ||
      providerRow?.system_prompt ||
      'Anda adalah Freya-san AI (Nexara). Jawab akurat dalam Bahasa Indonesia dan sertakan sumber bila tersedia.';

    const response = await client.models.generateContent({
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

    return {
      ok: true,
      provider: 'gemini-nexara',
      model,
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

    addSystemLog('error', 'aiService', `Gemini call failed: ${message}`);

    return {
      ok: false,
      provider: 'gemini-nexara',
      model,
      text: '',
      citations: [],
      latencyMs,
      error: message,
    };
  }
}

export async function researchOfficial48GroupSource(params: {
  query: string;
  groupId: string;
  requestedBy: string;
}): Promise<{ ok: boolean; verificationId?: string; summary: string; citations: Array<{ title: string; url: string }>; error?: string }> {
  const prompt = `Lakukan riset fakta resmi 48Group untuk grup "${params.groupId.toUpperCase()}" mengenai: "${params.query}".
Aturan ketat:
1. Prioritaskan situs resmi (seperti jkt48.com, akb48.co.jp, bnk48.com, mnl48.ph, dll.).
2. Jangan mengarang nama member, generasi, tanggal debut/kelulusan, atau setlist.
3. Jika informasi tidak ditemukan dari sumber resmi, tulis secara eksplisit "belum terverifikasi".
4. Kembalikan ringkasan fakta dalam Bahasa Indonesia yang ringkas dan jelas.`;

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
