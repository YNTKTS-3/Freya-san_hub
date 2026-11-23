import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Command, ExternalLink, Search, ShieldCheck, Terminal, Wifi } from 'lucide-react';
import { TRANSLATIONS } from '../core/i18n';
import { DEFAULT_PREFIXES } from '../core/prefixParser';
import { LanguageCode } from '../core/types';

export type PublicSection = 'home' | 'features' | 'commands' | 'docs' | 'status';

interface PublicOverviewData {
  projectName: string;
  botName: string;
  version: string;
  prefixes: Array<{ prefix: string; is_default: number; enabled: number; usage_count: number }>;
  publicCommandCount: number;
  activePublicCommandCount: number;
  totalRegistryCount: number;
  stats48: { groups: number; members: number; questions: number; theater: number };
  waStatus: string;
  changelog: Array<{ version: string; date: string; title: string; highlights: string[] }>;
}

interface PublicCommandRow {
  name: string;
  category: string;
  description: string;
  example: string;
  permission: string;
  status: string;
  enabled: number;
  cooldown_sec: number;
  daily_limit: number;
  required_provider: string | null;
  required_plugin: string | null;
  has_real_handler: number;
  aliases_csv: string | null;
}

interface HealthData {
  components: Array<{ name: string; status: string; detail: string }>;
  system: { uptimeSec: number; memoryUsedMb: number; memoryTotalMb: number; cpuLoad1m: number; nodeVersion: string };
}

interface PublicPortalProps {
  section: PublicSection;
  language: LanguageCode;
  onNavigateSection: (sec: PublicSection) => void;
  onOpen48Group: () => void;
  onOpenGames: () => void;
  onOpenDashboard: () => void;
}

const FEATURE_CATALOG = [
  { key: 'AI', title: 'AI & Nexara', desc: 'Asisten percakapan cerdas server-side dengan fallback multi-provider dan kontrol konteks.', cmd: '.nexara halo', req: 'GEMINI_API_KEY' },
  { key: 'DOWNLOAD', title: 'Downloader', desc: 'Adapter terstruktur untuk pengunduhan media sosial dan audio dari tautan publik.', cmd: '.tiktoknowm <url>', req: 'Plugin downloader-provider' },
  { key: 'GAME', title: 'Game Center Umum', desc: 'Werewolf Classic, Mafia, Sloth virtual, Tic Tac Toe, Tebak Kata, Family 100 dengan pencatatan sesi.', cmd: '.sloth / .werewolf', req: 'Siap pakai' },
  { key: '48GROUP', title: '48Group Center', desc: 'Pusat informasi resmi 48Group (JKT48, AKB48, dll.) dan permainan kuis berbasis fakta terverifikasi.', cmd: '.48group / .member48 Freya', req: 'Siap pakai' },
  { key: 'GROUP', title: 'Group Management', desc: 'Moderasi grup, anti-fitur (OFF secara default), absensi, pengingat, serta manajemen sewa.', cmd: '.antiluar / .reqjoin list', req: 'Admin Grup' },
  { key: 'INFO', title: 'Information & Economy', desc: 'Profil pengguna, balance virtual, EXP, level, limit harian, info gempa BMKG, dan papan peringkat.', cmd: '.profile / .infogempa', req: 'Siap pakai' },
  { key: 'RANDOM', title: 'Random & Hiburan', desc: 'Generator pantun, kata bijak, fakta unik, angka acak, dan penentu keputusan.', cmd: '.pantun / .faktaunik', req: 'Siap pakai' },
  { key: 'SEARCH', title: 'Search Intelligence', desc: 'Pencarian informasi publik seperti cuaca, jadwal shalat, arti nama, dan Wikipedia.', cmd: '.infounsur Au', req: 'Siap pakai / API' },
  { key: 'STICKER', title: 'Sticker Studio', desc: 'Pengolahan stiker WhatsApp dengan pengaturan watermark kustom per pengguna.', cmd: '.setwm Nama', req: 'Plugin sticker-processor' },
  { key: 'TEXTMAKER', title: 'Text Maker', desc: '38 gaya tipografi visual kanonik (avengers, blackpink, neon, glitch, wolf, dll.).', cmd: '.neon Freya-san', req: 'Siap pakai' },
  { key: 'TOOLS', title: 'Tools & Folio', desc: 'Pembuat dokumen kertas folio (.folio), QR code, enkoder Base64/Hex, dan utilitas teks.', cmd: '.folio {judul}SKRIPSI', req: 'Siap pakai' },
  { key: 'OWNER', title: 'Owner Governance', desc: 'Manajemen prefix, command, redeem, backup terenkripsi, dan audit sistem (khusus owner).', cmd: 'Khusus Owner Console', req: 'Autentikasi Owner' },
];

export const PublicPortal: React.FC<PublicPortalProps> = ({
  section,
  language,
  onNavigateSection,
  onOpen48Group,
  onOpenGames,
  onOpenDashboard,
}) => {
  const t = TRANSLATIONS[language];
  const [overview, setOverview] = useState<PublicOverviewData | null>(null);
  const [commands, setCommands] = useState<PublicCommandRow[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [prefixFilter, setPrefixFilter] = useState('.');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetch('/api/public/overview')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setOverview(d); })
      .catch(() => {});

    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setHealth(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (section !== 'commands') return;
    const qs = new URLSearchParams({ search, category: catFilter, status: statusFilter });
    fetch(`/api/public/commands?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setCommands(d.commands); })
      .catch(() => {});
  }, [section, search, catFilter, statusFilter]);

  if (section === 'features') {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-10">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold tracking-wider text-blue-700 dark:text-blue-400">KATALOG MODUL & FITUR</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            Katalog Kemampuan Freya-san Hub
          </h1>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Seluruh kategori fitur dikelompokkan dengan status implementasi transparan, persyaratan provider, dan contoh penggunaan langsung.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURE_CATALOG.map((f, idx) => (
            <div
              key={f.key}
              className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-5"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-medium">{String(idx + 1).padStart(2, '0')} · {f.key}</span>
                  <span>{f.req}</span>
                </div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{f.title}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.desc}</p>
              </div>
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                <code className="text-xs font-mono text-blue-700 dark:text-blue-400 truncate">{f.cmd}</code>
                <button
                  type="button"
                  onClick={() => {
                    if (f.key === '48GROUP') onOpen48Group();
                    else if (f.key === 'GAME') onOpenGames();
                    else if (f.key === 'OWNER') onOpenDashboard();
                    else {
                      setCatFilter(f.key);
                      onNavigateSection('commands');
                    }
                  }}
                  className="text-xs font-medium text-pink-600 dark:text-pink-400 hover:underline whitespace-nowrap shrink-0"
                >
                  Lihat Detail
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'commands') {
    const categories = ['ALL', 'AI', 'DOWNLOAD', 'GAME', '48GROUP', 'GENERAL', 'GROUP', 'INFO', 'RANDOM', 'SEARCH', 'STICKER', 'TEXTMAKER', 'TOOLS'];
    return (
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t.commandExplorerTitle}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Menampilkan command publik dan grup. Command khusus owner disembunyikan sesuai kebijakan privasi sistem.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {commands.length} command cocok
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="md:col-span-2 relative">
            <label htmlFor="cmd-search" className="sr-only">Cari command</label>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="cmd-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label htmlFor="cmd-cat" className="sr-only">Filter kategori</label>
            <select
              id="cmd-cat"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c === 'ALL' ? t.allCategories : c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <label htmlFor="cmd-prefix" className="sr-only">Pilih contoh prefix</label>
            <select
              id="cmd-prefix"
              value={prefixFilter}
              onChange={(e) => setPrefixFilter(e.target.value)}
              className="w-24 px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            >
              {DEFAULT_PREFIXES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <label htmlFor="cmd-status" className="sr-only">Filter status</label>
            <select
              id="cmd-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            >
              <option value="all">Semua Status</option>
              <option value="active">Active</option>
              <option value="pending_integration">Pending Integration</option>
              <option value="pending_specification">Pending Spec</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Command</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Deskripsi</th>
                <th className="py-3 px-4">Akses</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {commands.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-500">
                    Tidak ada command yang cocok dengan filter pencarian Anda.
                  </td>
                </tr>
              ) : (
                commands.slice(0, 120).map((c) => (
                  <tr key={c.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {prefixFilter}{c.name}
                      {c.aliases_csv && (
                        <div className="text-xs text-slate-400 font-normal">alias: {c.aliases_csv}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {c.category}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-200 max-w-md">
                      {c.description}
                      {c.required_provider && (
                        <span className="ml-2 text-xs text-slate-400">· Provider: {c.required_provider}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {c.permission}
                    </td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap">
                      <span className={c.status === 'active' && c.enabled ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-amber-700 dark:text-amber-400'}>
                        {c.enabled ? c.status : 'disabled'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === 'docs') {
    const sections = [
      {
        title: '01. Menghubungkan Bot WhatsApp',
        body: 'Buka Owner Console → Connection Manager, lalu tekan tombol Hubungkan WhatsApp. Pindai QR Code menggunakan aplikasi WhatsApp (Perangkat Tertaut). Kredensial sesi disimpan di folder data/wa-auth dan mendukung pemulihan otomatis saat server dimulai ulang.',
      },
      {
        title: '02. Sistem 10 Prefix Aktif & Format Spasi',
        body: 'Seluruh 10 prefix default (. , ? ! * @ # $ & /) langsung aktif sejak instalasi awal. Pengguna dapat mengetik perintah tanpa spasi (.menu) maupun dengan spasi (. menu). Tanda baca di tengah kalimat tidak akan dianggap sebagai perintah.',
      },
      {
        title: '03. Interactive List Menu & Fallback Otomatis',
        body: 'Perintah menu membuka daftar kategori bertingkat (AI, DOWNLOAD, GAME → 48GROUP, GENERAL, GROUP, INFO, RANDOM, SEARCH, STICKER, TEXTMAKER, TOOLS). Jika perangkat WhatsApp tidak merender pesan daftar interaktif, sistem otomatis mengirim menu teks bernomor.',
      },
      {
        title: '04. Dokumen Kertas Folio (.folio)',
        body: 'Gunakan tag {judul}, {tengah}, {kiri}, {kanan}, {tebal}, {miring}, serta {baris1}, {baris2}, {baris3} untuk menyusun surat atau dokumen rapi langsung dari chat.',
      },
      {
        title: '05. Keamanan, Privasi & Integritas 48Group',
        body: 'Nomor owner privat tidak pernah ditampilkan pada halaman publik. Seluruh kuis 48Group hanya mengambil data berstatus official_verified yang bersumber dari situs resmi dan telah melalui alur persetujuan owner.',
      },
    ];
    return (
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-wider text-blue-700 dark:text-blue-400">DOKUMENTASI PLATFORM</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Panduan Operasional Freya-san Hub v5.0
          </h1>
          <p className="text-slate-600 dark:text-slate-300">
            Referensi arsitektur, tata cara penggunaan command, konfigurasi grup, dan kebijakan privasi platform.
          </p>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-b border-slate-200 dark:border-slate-800">
          {sections.map((s) => (
            <div key={s.title} className="py-7 space-y-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{s.title}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'status') {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Status Layanan & Kesehatan Sistem
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Status komponen di bawah berasal langsung dari pemeriksaan health-check server saat ini.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {health?.components.map((c) => (
            <div key={c.name} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-semibold text-slate-900 dark:text-white">{c.name}</h2>
                <p className="text-xs text-slate-600 dark:text-slate-300">{c.detail}</p>
              </div>
              <span className={`text-xs font-mono font-medium whitespace-nowrap ${
                c.status === 'operational' || c.status === 'connected'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}>
                {c.status}
              </span>
            </div>
          ))}
        </div>

        {health?.system && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500">Uptime Server</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">{health.system.uptimeSec}s</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Memori Terpakai</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">{health.system.memoryUsedMb} / {health.system.memoryTotalMb} MB</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Beban CPU (1m)</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">{health.system.cpuLoad1m}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Runtime Node.js</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">{health.system.nodeVersion}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Homepage (JKT48-inspired structured layout + Wibusoft platform clarity)
  return (
    <div className="space-y-16 pb-16">
      {/* Hero Split */}
      <section className="max-w-7xl mx-auto px-6 pt-10 md:pt-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6 py-4">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-400">
              <span>Freya-san bot by Pak Ujan</span>
              <span aria-hidden="true">·</span>
              <span>Versi {overview?.version ?? '5.0'}</span>
              <span aria-hidden="true">·</span>
              <span className="text-pink-600 dark:text-pink-400">10 Prefix Aktif</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
              {t.heroTitle}
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              {t.heroSubtitle}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onOpen48Group}
                className="px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {t.heroPrimaryCta}
              </button>
              <button
                type="button"
                onClick={() => onNavigateSection('commands')}
                className="px-5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                {t.heroSecondaryCta}
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 min-h-[280px]">
            <img
              src="/src/assets/images/hero_freyasan_platform_1795430216249.jpg"
              alt="Pusat Kendali Platform Freya-san Hub"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/55 to-transparent flex items-end p-6">
              <div className="flex items-center gap-4 text-white">
                <img
                  src="/src/assets/images/avatar_freya_bot_1795430216520.jpg"
                  alt="Emblem Freya-san Bot"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover border border-white/20"
                />
                <div>
                  <div className="text-sm font-semibold">Freya-san Hub Unified Engine</div>
                  <div className="text-xs text-slate-300">
                    WhatsApp Engine ({overview?.waStatus ?? 'ready'}) · Database SQLite · Gemini Nexara
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width Key Platform Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Inventaris Command</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              {overview?.totalRegistryCount ?? 566}
            </div>
            <div className="text-xs text-slate-500 mt-1">13 kategori teraudit</div>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Prefix Aktif Bawaan</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 mt-1">
              {overview?.prefixes.length ?? 10}
            </div>
            <div className="text-xs text-slate-500 mt-1 font-mono">. , ? ! * @ # $ & /</div>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Arsip 48Group Terverifikasi</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-pink-600 dark:text-pink-400 mt-1">
              {overview?.stats48.groups ?? 10} Grup · {overview?.stats48.members ?? 8} Member
            </div>
            <div className="text-xs text-slate-500 mt-1">{overview?.stats48.theater ?? 4} Setlist Theater</div>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Mode Permainan</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              26
            </div>
            <div className="text-xs text-slate-500 mt-1">Umum & 48Group terpisah</div>
          </div>
        </div>
      </section>

      {/* Featured Dual Showcase: 48GROUP CENTER & GAME CENTER */}
      <section className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-56 overflow-hidden bg-slate-900">
              <img
                src="/src/assets/images/showcase_48group_theater_1795430216195.jpg"
                alt="Arsip Theater & 48Group Intelligence Center"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-pink-600 dark:text-pink-400">MODUL UNGGULAN</div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">48GROUP CENTER</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Pusat kecerdasan dan arsip resmi JKT48, AKB48, dan seluruh sister group: profil member, diskografi, setlist theater, kalender event, kamus istilah, verifikasi fakta, serta 48Group Game Center.
                </p>
              </div>
              <div className="flex items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={onOpen48Group}
                  className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Masuk 48Group Center
                </button>
                <span className="text-xs text-slate-500">Data terverifikasi sumber resmi</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-56 overflow-hidden bg-slate-100 dark:bg-slate-800">
              <img
                src="/src/assets/images/showcase_game_arena_1795430217101.jpg"
                alt="Arena Game Center Umum dan Multiplayer"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">ARENA INTERAKTIF</div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Game Center & Activity Engine</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Werewolf Classic, Mafia, Sloth virtual, Tebak Bom, Tebak Kata, Sambung Kata, Family 100, dan Tic Tac Toe dengan kunci sesi anti-spam serta pemisahan log Private Chat dan Group Chat.
                </p>
              </div>
              <div className="flex items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={onOpenGames}
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Buka Game Center
                </button>
                <span className="text-xs text-slate-500">Dapat dimainkan via Web & WhatsApp</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* News & Changelog Section (JKT48-style clean list) */}
      <section className="max-w-7xl mx-auto px-6">
        <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Pembaruan Sistem & Changelog</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Catatan rilis resmi arsitektur Freya-san Hub</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateSection('status')}
              className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Periksa Status Layanan
            </button>
          </div>
          {overview?.changelog.map((item) => (
            <div key={item.version} className="space-y-3">
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">v{item.version}</span>
                <span aria-hidden="true">·</span>
                <span>{item.date}</span>
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">{item.title}</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                {item.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
