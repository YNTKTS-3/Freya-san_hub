import React, { useEffect, useState } from 'react';
import { Code2, Play, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';

interface CustomCommandBuilderPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
}

interface VisualBlockInput {
  type: 'reply_text' | 'random_choice' | 'calculate' | 'conditional' | 'log_note';
  template: string;
  options?: string[];
  conditionContains?: string;
}

export const CustomCommandBuilderPanel: React.FC<CustomCommandBuilderPanelProps> = ({ apiFetch }) => {
  const [commands, setCommands] = useState<any[]>([]);
  const [mode, setMode] = useState<'visual' | 'script'>('visual');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [aliasesCsv, setAliasesCsv] = useState('');
  const [permission, setPermission] = useState<'public' | 'group_admin' | 'owner'>('public');
  const [cooldownSec, setCooldownSec] = useState(3);
  const [blocks, setBlocks] = useState<VisualBlockInput[]>([
    { type: 'reply_text', template: 'Halo {{sender}}! Pesan kamu: {{args}}' },
  ]);
  const [scriptTemplate, setScriptTemplate] = useState('Hai {{sender}}, hasil random: {{random:Kopi|Teh|Matcha}}');

  const [sampleArgs, setSampleArgs] = useState('test 123');
  const [sampleSender, setSampleSender] = useState('Tester Dashboard');
  const [testOutput, setTestOutput] = useState<{ ok: boolean; replyText?: string; errors?: string[] } | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadCommands = async () => {
    const res = await apiFetch('/api/admin/custom-commands');
    if (res?.ok) setCommands(res.commands || []);
  };

  useEffect(() => {
    void loadCommands();
  }, []);

  const buildPayload = () => ({
    name: name.trim().toLowerCase(),
    description: description.trim(),
    aliases: aliasesCsv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    builder_mode: mode,
    visual_blocks: blocks,
    script_template: scriptTemplate,
    permission,
    cooldown_sec: cooldownSec,
    enabled: true,
  });

  const handleSandboxTest = async () => {
    setSaveMessage(null);
    const res = await apiFetch('/api/admin/custom-commands/test', {
      method: 'POST',
      body: JSON.stringify({
        ...buildPayload(),
        sampleArgs,
        sampleSenderName: sampleSender,
        chatScope: 'private',
      }),
    });
    setTestOutput({ ok: Boolean(res?.ok), replyText: res?.replyText, errors: res?.errors || (res?.error ? [res.error] : undefined) });
  };

  const handleSave = async () => {
    setSaveMessage(null);
    const res = await apiFetch('/api/admin/custom-commands', {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
    });
    if (res?.ok) {
      setSaveMessage(`Custom command "${res.command.name}" berhasil disimpan & aktif di dispatcher bot.`);
      await loadCommands();
    } else {
      setSaveMessage(res?.error || (Array.isArray(res?.errors) ? res.errors.join(' ') : 'Gagal menyimpan custom command.'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Custom Command Builder &amp; Sandbox
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Buat command baru lewat blok visual atau script template aman (eksekusi terisolasi tanpa akses <code className="font-mono">eval</code>/<code className="font-mono">child_process</code>).
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('visual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === 'visual' ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-200 dark:border-slate-700'}`}
            >
              Visual Builder
            </button>
            <button
              type="button"
              onClick={() => setMode('script')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === 'script' ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-200 dark:border-slate-700'}`}
            >
              Script Editor
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label htmlFor="cc-name" className="block font-semibold mb-1">Nama Command (tanpa prefix)</label>
            <input
              id="cc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="misal: sapaaku"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label htmlFor="cc-aliases" className="block font-semibold mb-1">Aliases (pisah koma)</label>
            <input
              id="cc-aliases"
              type="text"
              value={aliasesCsv}
              onChange={(e) => setAliasesCsv(e.target.value)}
              placeholder="haiaku, greetme"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label htmlFor="cc-perm" className="block font-semibold mb-1">Permission</label>
            <select
              id="cc-perm"
              value={permission}
              onChange={(e) => setPermission(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            >
              <option value="public">public</option>
              <option value="group_admin">group_admin</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <div>
            <label htmlFor="cc-cooldown" className="block font-semibold mb-1">Cooldown (detik)</label>
            <input
              id="cc-cooldown"
              type="number"
              min={0}
              max={3600}
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
        </div>

        <div className="text-xs">
          <label htmlFor="cc-desc" className="block font-semibold mb-1">Deskripsi</label>
          <input
            id="cc-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Deskripsi singkat fungsi custom command"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
          />
        </div>

        {mode === 'visual' ? (
          <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold">Blok Logika Visual</span>
              <button
                type="button"
                onClick={() => setBlocks((b) => [...b, { type: 'reply_text', template: '' }])}
                className="px-2.5 py-1 rounded bg-blue-700 text-white font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Tambah Blok
              </button>
            </div>
            {blocks.map((blk, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <select
                    aria-label={`Tipe blok ${idx + 1}`}
                    value={blk.type}
                    onChange={(e) =>
                      setBlocks((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, type: e.target.value as any } : item)),
                      )
                    }
                    className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="reply_text">Reply Text / Template</option>
                    <option value="random_choice">Random Choice</option>
                    <option value="calculate">Hitung Ekspresi Matematika</option>
                    <option value="conditional">Kondisional (Jika Argumen Mengandung)</option>
                  </select>
                  {blocks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setBlocks((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-rose-600 text-[11px] font-semibold"
                    >
                      Hapus Blok
                    </button>
                  )}
                </div>
                {blk.type === 'conditional' && (
                  <input
                    type="text"
                    value={blk.conditionContains || ''}
                    onChange={(e) =>
                      setBlocks((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, conditionContains: e.target.value } : item)),
                      )
                    }
                    placeholder="Kata kunci di {{args}}"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                )}
                <input
                  type="text"
                  value={blk.template}
                  onChange={(e) =>
                    setBlocks((prev) => prev.map((item, i) => (i === idx ? { ...item, template: e.target.value } : item)))
                  }
                  placeholder={blk.type === 'calculate' ? '{{args}}' : 'Halo {{sender}}, argumen: {{args}}'}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <label htmlFor="cc-script" className="block font-semibold">
              Script Template Aman (Variabel: <code>{'{{sender}}'}</code>, <code>{'{{args}}'}</code>, <code>{'{{arg0}}'}</code>, <code>{'{{scope}}'}</code>, <code>{'{{random:A|B}}'}</code>, <code>{'{{calc:2+3}}'}</code>)
            </label>
            <textarea
              id="cc-script"
              rows={5}
              value={scriptTemplate}
              onChange={(e) => setScriptTemplate(e.target.value)}
              className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
        )}

        {/* Sandbox Test & Save */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3 text-xs">
          <div className="font-bold text-slate-900 dark:text-white">Uji Sandbox Sebelum Simpan</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={sampleSender}
              onChange={(e) => setSampleSender(e.target.value)}
              placeholder="Nama pengirim uji"
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
            <input
              type="text"
              value={sampleArgs}
              onChange={(e) => setSampleArgs(e.target.value)}
              placeholder="Contoh argumen"
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSandboxTest()}
              className="px-3.5 py-2 rounded-lg border border-blue-600 text-blue-700 dark:text-blue-400 font-semibold inline-flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Test-Run Sandbox
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" /> Simpan Custom Command
            </button>
          </div>
          {testOutput && (
            <div className={`p-3 rounded-lg border ${testOutput.ok ? 'border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30' : 'border-rose-300 bg-rose-50/70 dark:bg-rose-950/30'}`}>
              <div className="font-semibold mb-1">{testOutput.ok ? 'Hasil Sandbox:' : 'Validasi / Sandbox Error:'}</div>
              <pre className="font-mono whitespace-pre-wrap">{testOutput.replyText || testOutput.errors?.join('\n')}</pre>
            </div>
          )}
          {saveMessage && <div className="text-xs text-blue-700 dark:text-blue-400 font-medium">{saveMessage}</div>}
        </div>
      </div>

      {/* Saved Custom Commands List */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Custom Commands Tersimpan ({commands.length})</h3>
          <button
            type="button"
            onClick={() => void loadCommands()}
            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {commands.length === 0 ? (
          <p className="text-xs text-slate-500">Belum ada custom command tersimpan.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {commands.map((c) => (
              <div key={c.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono font-bold text-blue-700 dark:text-blue-400">
                    #{c.name} <span className="text-slate-400 font-normal">({c.builder_mode} · {c.permission} · {c.usage_count}x)</span>
                  </div>
                  <div className="text-slate-500">{c.description || 'Tanpa deskripsi'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch('/api/admin/custom-commands', {
                        method: 'POST',
                        body: JSON.stringify({
                          id: c.id,
                          name: c.name,
                          description: c.description,
                          aliases: JSON.parse(c.aliases_json || '[]'),
                          builder_mode: c.builder_mode,
                          visual_blocks: JSON.parse(c.visual_blocks_json || '[]'),
                          script_template: c.script_template,
                          permission: c.permission,
                          cooldown_sec: c.cooldown_sec,
                          enabled: !c.enabled,
                        }),
                      });
                      await loadCommands();
                    }}
                    className={`px-2.5 py-1 rounded font-semibold ${c.enabled ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                  >
                    {c.enabled ? 'Aktif' : 'Nonaktif'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus ${c.name}`}
                    onClick={async () => {
                      await apiFetch(`/api/admin/custom-commands/${encodeURIComponent(c.name)}`, { method: 'DELETE' });
                      await loadCommands();
                    }}
                    className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
