import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { FortyEightCalendarWidget } from './FortyEightCalendarWidget';

interface DifficultyLevelSummary {
  id: 'level_1' | 'level_2' | 'level_3';
  level_order: number;
  title: string;
  difficulty_label: string;
  era_category: string;
  period_range: string;
  description: string;
  verification_status: string;
  source_title: string;
  source_url: string;
  counts?: { members: number; discography: number; theater: number; questions: number };
}

interface TeamGroupSummary {
  id: 'old' | 'new' | 'other';
  title: string;
  description: string;
  disclaimer: string;
  teamCount?: number;
  teamsPreview?: string[];
}

interface TeamSummary {
  id: string;
  team_group: string;
  name: string;
  historical_status: string;
  era_summary: string;
  description: string;
  verification_status: string;
  source_title: string;
  source_url: string;
  memberCount?: number;
}

interface IntelligenceData {
  groups: Array<{
    id: string; name: string; base_city: string; country: string; founded_year: number;
    status: string; official_site: string; description: string; sister_relation: string;
    source_title: string; source_url: string; retrieved_at: string;
  }>;
  generations: Array<{ id: string; group_id: string; gen_label: string; debut_year: number; notes: string; source_url: string }>;
  members: Array<{
    id: string; name: string; nickname: string; group_id: string; generation: string; status: string;
    birth_date?: string | null; joined_date: string | null; graduated_date: string | null; bio: string; career_notes: string;
    source_title: string; source_url: string; retrieved_at: string;
    primary_team_id?: string | null; difficulty_level?: string | null;
  }>;
  discography: Array<{
    id: string; group_id: string; title: string; release_type: string; release_date: string;
    center_member: string | null; label: string; senbatsu_notes: string; source_url: string;
  }>;
  theater: Array<{
    id: string; group_id: string; setlist_name: string; stage_number: string; opening_song: string;
    tracklist_json: string; period: string; notes: string; source_url: string;
  }>;
  events: Array<{
    id: string; group_id: string; title: string; event_type: string; event_date: string;
    venue: string; summary: string; source_url: string; retrieved_at: string;
  }>;
  terminology: Array<{ id: string; term: string; category: string; definition: string; source_url: string }>;
  sources: Array<{ id: string; group_id: string; source_name: string; url: string; source_type: string; last_checked_at: string }>;
  history: Array<{ id: number; entity_type: string; entity_id: string; change_summary: string; source_url: string; created_at: string }>;
  eras?: DifficultyLevelSummary[];
  teams?: TeamSummary[];
}

interface GameCatalogItem {
  game_id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
  enabled: number;
  duration_sec: number;
}

interface Active48Session {
  id: string;
  gameId: string;
  gameName: string;
  status: string;
  state: {
    question?: string;
    prompt?: string;
    options?: string[];
    sourceUrl?: string;
    explanation?: string;
    difficulty?: string;
    difficultyLevel?: string | null;
    teamId?: string | null;
    hintsUsed?: number;
  };
}

export const FortyEightCenter: React.FC = () => {
  const [mainTab, setMainTab] = useState<'intelligence' | 'game_center'>('intelligence');
  const [subModule, setSubModule] = useState<
    'difficulty' | 'teams' | 'members' | 'groups' | 'discography' | 'theater' | 'events' | 'terminology' | 'sources'
  >('difficulty');
  const [intel, setIntel] = useState<IntelligenceData | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');

  // Tiered Difficulty Explorer state
  const [diffLevels, setDiffLevels] = useState<DifficultyLevelSummary[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [diffDetail, setDiffDetail] = useState<{
    era: DifficultyLevelSummary;
    members: any[];
    totalMembers: number;
    page: number;
    pageSize: number;
    availableGenerations: string[];
    discography: any[];
    theater: any[];
    events: any[];
    questionCount: number;
  } | null>(null);
  const [diffSearch, setDiffSearch] = useState('');
  const [diffStatusFilter, setDiffStatusFilter] = useState('all');
  const [diffGenFilter, setDiffGenFilter] = useState('all');
  const [diffPage, setDiffPage] = useState(1);
  const [diffLoading, setDiffLoading] = useState(false);

  // Tiered Team Explorer state
  const [teamGroups, setTeamGroups] = useState<TeamGroupSummary[]>([]);
  const [selectedTeamGroup, setSelectedTeamGroup] = useState<'old' | 'new' | 'other' | null>(null);
  const [teamsInGroup, setTeamsInGroup] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamDetail, setTeamDetail] = useState<{
    team: TeamSummary;
    members: any[];
    totalMembers: number;
    page: number;
    pageSize: number;
    questionCount: number;
  } | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamMemberStatus, setTeamMemberStatus] = useState('all');
  const [teamPage, setTeamPage] = useState(1);
  const [teamLoading, setTeamLoading] = useState(false);

  // 48Group Game Center state
  const [games48, setGames48] = useState<GameCatalogItem[]>([]);
  const [leaderboard48, setLeaderboard48] = useState<Array<{ display_name: string; total_score: number; total_wins: number; games_played: number }>>([]);
  const [playerName, setPlayerName] = useState('Pengunjung 48');
  const [playerPhone, setPlayerPhone] = useState('6280000000001');
  const [gameLevelFilter, setGameLevelFilter] = useState('');
  const [gameTeamFilter, setGameTeamFilter] = useState('');
  const [activeSession, setActiveSession] = useState<Active48Session | null>(null);
  const [answerInput, setAnswerInput] = useState('');
  const [gameMessages, setGameMessages] = useState<string[]>([]);

  const loadData = () => {
    fetch('/api/48group/intelligence')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setIntel(d); })
      .catch(() => {});

    fetch('/api/games/catalog')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setGames48((d.games as GameCatalogItem[]).filter((g) => g.domain === '48group'));
          setLeaderboard48(d.leaderboard48 || []);
        }
      })
      .catch(() => {});
    fetch('/api/48group/difficulty-explorer')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setDiffLevels(d.levels || []);
      })
      .catch(() => {});

    fetch('/api/48group/team-explorer')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setTeamGroups(d.teamGroups || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedLevelId) {
      setDiffDetail(null);
      return;
    }
    setDiffLoading(true);
    const params = new URLSearchParams({
      levelId: selectedLevelId,
      search: diffSearch,
      status: diffStatusFilter,
      generation: diffGenFilter,
      page: String(diffPage),
      pageSize: '6',
    });
    fetch(`/api/48group/difficulty-explorer?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setDiffDetail(d);
      })
      .finally(() => setDiffLoading(false));
  }, [selectedLevelId, diffSearch, diffStatusFilter, diffGenFilter, diffPage]);

  useEffect(() => {
    if (!selectedTeamGroup) {
      setTeamsInGroup([]);
      return;
    }
    setTeamLoading(true);
    fetch(`/api/48group/team-explorer?group=${selectedTeamGroup}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setTeamsInGroup(d.teams || []);
      })
      .finally(() => setTeamLoading(false));
  }, [selectedTeamGroup]);

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamDetail(null);
      return;
    }
    setTeamLoading(true);
    const params = new URLSearchParams({
      teamId: selectedTeamId,
      search: teamSearch,
      status: teamMemberStatus,
      page: String(teamPage),
      pageSize: '8',
    });
    fetch(`/api/48group/team-explorer?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setTeamDetail(d);
      })
      .finally(() => setTeamLoading(false));
  }, [selectedTeamId, teamSearch, teamMemberStatus, teamPage]);

  const start48Game = async (gameId: string, overrideLevel?: string, overrideTeam?: string) => {
    const chosenLevel = overrideLevel !== undefined ? overrideLevel : gameLevelFilter;
    const chosenTeam = overrideTeam !== undefined ? overrideTeam : gameTeamFilter;
    const res = await fetch('/api/games/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId,
        playerName,
        playerPhone,
        chatScope: 'private',
        chatId: `web-48-${playerPhone}`,
        difficultyLevel: chosenLevel || undefined,
        teamId: chosenTeam || undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setGameMessages((prev) => [data.announcement || data.error, ...prev]);
      return;
    }
    setActiveSession(data.session);
    setGameMessages([data.announcement]);
    setAnswerInput('');
  };

  const send48Action = async (input: string, actionType: 'answer' | 'hint' | 'give_up' = 'answer') => {
    if (!activeSession) return;
    const res = await fetch('/api/games/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeSession.id,
        playerName,
        playerPhone,
        chatScope: 'private',
        chatId: `web-48-${playerPhone}`,
        input,
        actionType,
      }),
    });
    const data = await res.json();
    if (data.announcement) {
      setGameMessages((prev) => [...prev, data.announcement]);
    }
    setActiveSession((prev) => (prev ? { ...prev, status: data.sessionStatus, state: data.state } : null));
    setAnswerInput('');
    loadData();
  };

  const filteredMembers = (intel?.members ?? []).filter((m) => {
    if (groupFilter !== 'ALL' && m.group_id !== groupFilter) return false;
    if (memberSearch) {
      const hay = `${m.name} ${m.nickname} ${m.generation} ${m.status}`.toLowerCase();
      if (!hay.includes(memberSearch.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      {/* Header Banner */}
      <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-8 flex flex-col justify-between space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold tracking-wider text-pink-600 dark:text-pink-400">
              48GROUP CENTER · MODUL MANDIRI
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              48Group Intelligence, Archive & Game Center
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              Basis data terpadu seluruh generasi dan grup 48Group dengan tautan sumber resmi, waktu pengambilan, alur persetujuan owner, serta permainan kuis interaktif yang terhubung langsung ke fakta terverifikasi.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-full sm:w-fit">
            <button
              type="button"
              onClick={() => setMainTab('intelligence')}
              className={`flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-xs font-semibold rounded-md transition-colors text-center ${
                mainTab === 'intelligence'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              Intelligence & Archive Center
            </button>
            <button
              type="button"
              onClick={() => setMainTab('game_center')}
              className={`flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-xs font-semibold rounded-md transition-colors text-center ${
                mainTab === 'game_center'
                  ? 'bg-white dark:bg-slate-900 text-pink-600 dark:text-pink-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              48Group Game Center
            </button>
          </div>
        </div>
        <div className="lg:col-span-5 min-h-[220px] bg-slate-900">
          <img
            src="/src/assets/images/showcase_48group_theater_1795430216195.jpg"
            alt="Panggung Theater 48Group"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {mainTab === 'intelligence' ? (
        <div className="space-y-6">
          <FortyEightCalendarWidget
            events={intel?.events ?? []}
            members={intel?.members ?? []}
            onOpenEventsTab={() => setSubModule('events')}
          />

          {/* Submodules Navigation */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            {[
              { id: 'difficulty', label: 'Difficulty Explorer (JKT48)' },
              { id: 'teams', label: 'Team Explorer (JKT48)' },
              { id: 'members', label: 'Member Intelligence' },
              { id: 'groups', label: 'Group & Generasi' },
              { id: 'discography', label: 'Discography' },
              { id: 'theater', label: 'Theater Archive' },
              { id: 'events', label: 'Event & Calendar' },
              { id: 'terminology', label: 'Istilah & Budaya' },
              { id: 'sources', label: 'Verifikasi Sumber' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubModule(tab.id as typeof subModule)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  subModule === tab.id
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {subModule === 'difficulty' && (
            <div className="space-y-6">
              {!selectedLevelId ? (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Klasifikasi Era & Tingkat Kesulitan JKT48
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Pilih salah satu dari 3 level tetap di bawah ini untuk membuka daftar member, diskografi, theater, dan kuis khusus era tersebut.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {diffLevels.map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => {
                          setSelectedLevelId(lvl.id);
                          setDiffPage(1);
                          setDiffSearch('');
                          setDiffStatusFilter('all');
                          setDiffGenFilter('all');
                        }}
                        className="text-left p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-pink-500 transition-colors flex flex-col justify-between gap-4"
                      >
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-pink-600 dark:text-pink-400">
                            {lvl.era_category} · {lvl.period_range}
                          </div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white">
                            {lvl.title}
                          </h3>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {lvl.description}
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <span>
                            {lvl.counts?.members ?? 0} member · {lvl.counts?.discography ?? 0} rilisan · {lvl.counts?.questions ?? 0} soal
                          </span>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedLevelId(null)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke 3 Level Kesulitan
                    </button>
                    {diffDetail && (
                      <button
                        type="button"
                        onClick={() => {
                          setGameLevelFilter(diffDetail.era.id);
                          setMainTab('game_center');
                          void start48Game('memberquiz48', diffDetail.era.id, '');
                        }}
                        className="px-3.5 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold whitespace-nowrap"
                      >
                        Mainkan Kuis Era Ini ({diffDetail.questionCount} soal)
                      </button>
                    )}
                  </div>

                  {diffLoading && !diffDetail ? (
                    <div className="p-8 text-center text-sm text-slate-500">Memuat data era JKT48...</div>
                  ) : diffDetail ? (
                    <div className="space-y-6">
                      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{diffDetail.era.era_category} · {diffDetail.era.period_range} · {diffDetail.era.verification_status}</span>
                          <a href={diffDetail.era.source_url} target="_blank" rel="noreferrer" className="text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                            {diffDetail.era.source_title} <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{diffDetail.era.title}</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{diffDetail.era.description}</p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={diffSearch}
                            onChange={(e) => { setDiffSearch(e.target.value); setDiffPage(1); }}
                            placeholder="Cari member di era ini..."
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <select
                          value={diffStatusFilter}
                          onChange={(e) => { setDiffStatusFilter(e.target.value); setDiffPage(1); }}
                          className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <option value="all">Semua Status Member</option>
                          <option value="aktif">Member Aktif</option>
                          <option value="lulus">Lulus / Mantan Member</option>
                        </select>
                        <select
                          value={diffGenFilter}
                          onChange={(e) => { setDiffGenFilter(e.target.value); setDiffPage(1); }}
                          className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <option value="all">Semua Generasi</option>
                          {diffDetail.availableGenerations.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>

                      {diffDetail.members.length === 0 ? (
                        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-500 text-center">
                          Nggak ada member terverifikasi yang cocok sama filter pencarian di era ini.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {diffDetail.members.map((m) => (
                            <div key={m.id} className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                              <div className="text-xs text-slate-500">{m.generation} · {m.status}</div>
                              <div className="font-bold text-slate-900 dark:text-white">{m.name} ({m.nickname})</div>
                              <p className="text-xs text-slate-600 dark:text-slate-300">{m.bio}</p>
                              <div className="text-xs text-slate-400">
                                Bergabung: {m.joined_date || 'belum terverifikasi'}
                                {m.graduated_date ? ` · Lulus: ${m.graduated_date}` : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {diffDetail.totalMembers > diffDetail.pageSize && (
                        <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <span>Menampilkan halaman {diffDetail.page} ({diffDetail.totalMembers} member)</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={diffPage <= 1}
                              onClick={() => setDiffPage((p) => Math.max(1, p - 1))}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                            >
                              Sebelumnya
                            </button>
                            <button
                              type="button"
                              disabled={diffPage * diffDetail.pageSize >= diffDetail.totalMembers}
                              onClick={() => setDiffPage((p) => p + 1)}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                            >
                              Berikutnya
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Diskografi Terkait ({diffDetail.discography.length})</h4>
                          {diffDetail.discography.length === 0 ? (
                            <p className="text-xs text-slate-500">Belum ada rilisan tercatat untuk era ini.</p>
                          ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                              {diffDetail.discography.map((d) => (
                                <div key={d.id} className="py-2">
                                  <div className="font-semibold text-slate-900 dark:text-white">{d.title}</div>
                                  <div className="text-slate-500">{d.release_type} · {d.release_date} · Center: {d.center_member || '-'}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Setlist & Event Era Ini ({diffDetail.theater.length + diffDetail.events.length})</h4>
                          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {diffDetail.theater.map((t) => (
                              <div key={t.id} className="py-2">
                                <div className="font-semibold text-slate-900 dark:text-white">Theater: {t.setlist_name}</div>
                                <div className="text-slate-500">{t.stage_number} · Pembuka: {t.opening_song}</div>
                              </div>
                            ))}
                            {diffDetail.events.map((ev) => (
                              <div key={ev.id} className="py-2">
                                <div className="font-semibold text-slate-900 dark:text-white">Event: {ev.title}</div>
                                <div className="text-slate-500">{ev.event_date} · {ev.venue}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {subModule === 'teams' && (
            <div className="space-y-6">
              {!selectedTeamGroup ? (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Team Explorer JKT48 (Navigasi Bertingkat)
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Pilih kategori klasifikasi untuk menjelajahi susunan Team dan riwayat perpindahan member. Kategori Old/New adalah pengelompokan navigasi arsip internal.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {teamGroups.map((grp) => (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => {
                          setSelectedTeamGroup(grp.id);
                          setSelectedTeamId(null);
                        }}
                        className="text-left p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-600 transition-colors flex flex-col justify-between gap-4"
                      >
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                            {grp.teamsPreview?.join(' · ') || 'Kategori Arsip'}
                          </div>
                          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{grp.title}</h3>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{grp.description}</p>
                        </div>
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                          <span>{grp.teamCount ?? 0} sub-team</span>
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : !selectedTeamId ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setSelectedTeamGroup(null)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke Kategori Old / New / Other
                  </button>
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    {teamGroups.find((g) => g.id === selectedTeamGroup)?.disclaimer}
                  </div>
                  {teamLoading && teamsInGroup.length === 0 ? (
                    <div className="p-6 text-center text-sm text-slate-500">Memuat daftar Team...</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {teamsInGroup.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTeamId(t.id);
                            setTeamPage(1);
                            setTeamSearch('');
                            setTeamMemberStatus('all');
                          }}
                          className="text-left p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-pink-500 transition-colors flex flex-col justify-between gap-4"
                        >
                          <div className="space-y-2">
                            <div className="text-xs text-slate-500">
                              {t.era_summary} · {t.verification_status === 'official_verified' ? 'Terverifikasi Resmi' : 'Verifikasi Parsial'}
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t.name}</h3>
                            <div className="text-xs font-medium text-pink-600 dark:text-pink-400">{t.historical_status}</div>
                            <p className="text-xs text-slate-600 dark:text-slate-300">{t.description}</p>
                          </div>
                          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                            <span>{t.memberCount ?? 0} anggota / alumni tercatat</span>
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedTeamId(null)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke Daftar Team ({selectedTeamGroup.toUpperCase()})
                    </button>
                    {teamDetail && teamDetail.questionCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setGameTeamFilter(teamDetail.team.id);
                          setMainTab('game_center');
                          void start48Game('memberquiz48', '', teamDetail.team.id);
                        }}
                        className="px-3.5 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold"
                      >
                        Mainkan Kuis {teamDetail.team.name} ({teamDetail.questionCount} soal)
                      </button>
                    )}
                  </div>

                  {teamDetail && (
                    <div className="space-y-5">
                      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{teamDetail.team.era_summary} · Status: {teamDetail.team.verification_status}</span>
                          <a href={teamDetail.team.source_url} target="_blank" rel="noreferrer" className="text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                            {teamDetail.team.source_title} <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{teamDetail.team.name}</h3>
                        <div className="text-xs font-medium text-pink-600 dark:text-pink-400">{teamDetail.team.historical_status}</div>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{teamDetail.team.description}</p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={teamSearch}
                            onChange={(e) => { setTeamSearch(e.target.value); setTeamPage(1); }}
                            placeholder="Cari nama member atau alumni..."
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <select
                          value={teamMemberStatus}
                          onChange={(e) => { setTeamMemberStatus(e.target.value); setTeamPage(1); }}
                          className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <option value="all">Semua Status (Aktif & Alumni)</option>
                          <option value="aktif">Member Aktif</option>
                          <option value="lulus">Lulus / Mantan Member</option>
                        </select>
                      </div>

                      {teamDetail.members.length === 0 ? (
                        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-500 text-center">
                          Belum ada data anggota terverifikasi untuk kategori Team ini. Data yang belum diumumkan secara resmi tidak akan dikarang.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {teamDetail.members.map((m) => (
                            <div key={m.id} className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                              <div className="text-xs text-slate-500">
                                {m.generation} · {m.status}{m.role_in_team ? ` · ${m.role_in_team}` : ''}
                              </div>
                              <div className="font-bold text-slate-900 dark:text-white">{m.name} ({m.nickname})</div>
                              <p className="text-xs text-slate-600 dark:text-slate-300">{m.bio}</p>
                              {Array.isArray(m.teamTransfers) && m.teamTransfers.length > 0 && (
                                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 space-y-1">
                                  <div className="font-semibold text-slate-700 dark:text-slate-300">Riwayat Perpindahan Team:</div>
                                  {m.teamTransfers.map((tr: any) => (
                                    <div key={tr.id}>
                                      {tr.team_name} ({tr.joined_at || '?'} – {tr.left_at || 'Berlanjut'}) · {tr.role_in_team}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {teamDetail.totalMembers > teamDetail.pageSize && (
                        <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <span>Menampilkan halaman {teamDetail.page} ({teamDetail.totalMembers} anggota/alumni)</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={teamPage <= 1}
                              onClick={() => setTeamPage((p) => Math.max(1, p - 1))}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                            >
                              Sebelumnya
                            </button>
                            <button
                              type="button"
                              disabled={teamPage * teamDetail.pageSize >= teamDetail.totalMembers}
                              onClick={() => setTeamPage((p) => p + 1)}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                            >
                              Berikutnya
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {subModule === 'members' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Cari nama member, nama panggilan, atau generasi..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                >
                  <option value="ALL">Semua Grup</option>
                  {intel?.groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredMembers.map((m) => (
                  <div key={m.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {m.group_id.toUpperCase()} · {m.generation} · {m.status}
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                          {m.name} <span className="font-normal text-pink-600 dark:text-pink-400">({m.nickname})</span>
                        </h3>
                      </div>
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        Terverifikasi Resmi
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{m.bio}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{m.career_notes}</p>
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {m.birth_date ? `Lahir: ${m.birth_date} · ` : ''}
                        Bergabung: {m.joined_date || 'belum terverifikasi'}
                        {m.graduated_date ? ` · Lulus: ${m.graduated_date}` : ''}
                      </span>
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {m.source_title} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {subModule === 'groups' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {intel?.groups.map((g) => (
                  <div key={g.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{g.country} · {g.base_city} · Berdiri {g.founded_year}</span>
                      <span className="font-medium text-blue-700 dark:text-blue-400">{g.status}</span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{g.name}</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{g.description}</p>
                    <div className="text-xs text-slate-500">{g.sister_relation}</div>
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                      <a href={g.official_site} target="_blank" rel="noreferrer" className="text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                        Situs Resmi {g.name} <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="text-slate-400 font-mono">Diambil: {g.retrieved_at.slice(0, 10)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Arsip Generasi Terdaftar</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {intel?.generations.map((gen) => (
                    <div key={gen.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-mono text-pink-600 dark:text-pink-400">{gen.group_id.toUpperCase()} · {gen.debut_year}</div>
                      <div className="font-semibold text-sm text-slate-900 dark:text-white">{gen.gen_label}</div>
                      <div className="text-xs text-slate-500 mt-1">{gen.notes}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {subModule === 'discography' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {intel?.discography.map((d) => (
                <div key={d.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs text-slate-500">
                    {d.group_id.toUpperCase()} · {d.release_type} · {d.release_date}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{d.title}</h3>
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    Center: <span className="font-medium">{d.center_member || 'Tidak diumumkan'}</span>
                  </div>
                  <p className="text-xs text-slate-500">{d.senbatsu_notes} · Label: {d.label}</p>
                </div>
              ))}
            </div>
          )}

          {subModule === 'theater' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {intel?.theater.map((th) => {
                const tracks = JSON.parse(th.tracklist_json) as string[];
                return (
                  <div key={th.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-xs text-slate-500">{th.group_id.toUpperCase()} · {th.stage_number} · {th.period}</div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{th.setlist_name}</h3>
                    <div className="text-xs text-pink-600 dark:text-pink-400 font-medium">Lagu Pembuka: {th.opening_song}</div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{th.notes}</p>
                    <div className="text-xs text-slate-500">
                      Daftar lagu pilihan: {tracks.join(' · ')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {subModule === 'events' && (
            <div className="space-y-4">
              {intel?.events.map((ev) => (
                <div key={ev.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">{ev.group_id.toUpperCase()} · {ev.event_type} · {ev.event_date}</div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{ev.title}</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{ev.summary} ({ev.venue})</p>
                  </div>
                  <a href={ev.source_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0">
                    Sumber Resmi
                  </a>
                </div>
              ))}
            </div>
          )}

          {subModule === 'terminology' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {intel?.terminology.map((term) => (
                <div key={term.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs text-pink-600 dark:text-pink-400 font-medium">{term.category}</div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{term.term}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{term.definition}</p>
                </div>
              ))}
            </div>
          )}

          {subModule === 'sources' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Daftar Sumber Resmi Terpantau</h3>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {intel?.sources.map((s) => (
                    <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{s.source_name}</div>
                        <div className="text-xs text-slate-500">{s.source_type} · Diperiksa: {s.last_checked_at.slice(0, 10)}</div>
                      </div>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 dark:text-blue-400 hover:underline">
                        Buka
                      </a>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Riwayat Perubahan & Verifikasi</h3>
                {intel?.history.length === 0 ? (
                  <p className="text-sm text-slate-500">Belum ada perubahan data yang disetujui setelah inisialisasi awal. Owner dapat meninjau antrean verifikasi di Owner Console.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {intel?.history.map((h) => (
                      <div key={h.id} className="py-2.5">
                        <div className="font-medium text-slate-900 dark:text-white">{h.change_summary}</div>
                        <div className="text-xs text-slate-500">{h.entity_type} · {h.created_at}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 48GROUP GAME CENTER */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Identitas Pemain 48Group</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="p48-name" className="block text-xs text-slate-500 mb-1">Nama Tampilan</label>
                  <input
                    id="p48-name"
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="p48-phone" className="block text-xs text-slate-500 mb-1">ID / Nomor Sesi</label>
                  <input
                    id="p48-phone"
                    type="text"
                    value={playerPhone}
                    onChange={(e) => setPlayerPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Filter Era & Team Kuis JKT48</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="g48-lvl" className="block text-xs text-slate-500 mb-1">Tingkat Kesulitan / Era</label>
                  <select
                    id="g48-lvl"
                    value={gameLevelFilter}
                    onChange={(e) => setGameLevelFilter(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="">Semua Level / Era</option>
                    <option value="level_1">Level 1 — Mudah–Menengah (New–Fight 2022–2026)</option>
                    <option value="level_2">Level 2 — Menengah (Era One 2021–2022)</option>
                    <option value="level_3">Level 3 — Sulit (Group Release–Pre-One 2011–2021)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="g48-team" className="block text-xs text-slate-500 mb-1">Filter Team JKT48</label>
                  <select
                    id="g48-team"
                    value={gameTeamFilter}
                    onChange={(e) => setGameTeamFilter(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="">Semua Team</option>
                    {(intel?.teams || []).map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.team_group.toUpperCase()})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Pilih Mode Permainan 48Group</h2>
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {games48.map((g) => (
                  <div key={g.game_id} className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{g.name}</div>
                      <div className="text-xs text-slate-500">{g.description}</div>
                    </div>
                    <button
                      type="button"
                      disabled={!g.enabled}
                      onClick={() => start48Game(g.game_id)}
                      className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      Mulai
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            {/* Active Game Arena */}
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5 min-h-[340px]">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <div className="text-xs text-pink-600 dark:text-pink-400 font-semibold">ARENA PERMAINAN 48GROUP TERVERIFIKASI</div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    {activeSession ? `${activeSession.gameName} (${activeSession.id})` : 'Pilih mode permainan di panel kiri'}
                  </h2>
                </div>
                {activeSession && (
                  <span className="text-xs font-mono text-slate-500">{activeSession.status}</span>
                )}
              </div>

              {activeSession ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {activeSession.state.question || activeSession.state.prompt}
                    </div>
                    {activeSession.state.sourceUrl && (
                      <div className="text-xs text-slate-500">
                        Sumber fakta: {activeSession.state.sourceUrl} · Tingkat: {activeSession.state.difficulty || 'normal'}
                      </div>
                    )}
                    {Array.isArray(activeSession.state.options) && activeSession.status === 'active' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                        {activeSession.state.options.map((opt, idx) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => send48Action(String(idx + 1), 'answer')}
                            className="p-3 text-left text-sm rounded-lg border border-slate-200 dark:border-slate-700 hover:border-pink-500 hover:bg-pink-50/40 dark:hover:bg-pink-950/30 transition-colors"
                          >
                            <span className="font-mono text-xs text-slate-400 mr-2">{idx + 1}.</span>
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {(activeSession.status === 'active' || activeSession.status === 'waiting') && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && answerInput.trim()) void send48Action(answerInput); }}
                        placeholder="Ketik jawaban, gabung, atau mulai..."
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={() => answerInput.trim() && send48Action(answerInput)}
                        className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                      >
                        Kirim
                      </button>
                      <button
                        type="button"
                        onClick={() => send48Action('hint', 'hint')}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                      >
                        Hint (-20)
                      </button>
                      <button
                        type="button"
                        onClick={() => send48Action('nyerah', 'give_up')}
                        className="px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-medium"
                      >
                        Nyerah
                      </button>
                    </div>
                  )}

                  <div className="space-y-2 max-h-48 overflow-y-auto text-xs font-mono bg-slate-950 text-slate-100 p-4 rounded-lg whitespace-pre-wrap">
                    {gameMessages.map((m, i) => (
                      <div key={i} className="pb-2 border-b border-slate-800 last:border-0">{m}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="py-8 text-center text-sm text-slate-500">
                    Seluruh pertanyaan kuis 48Group bersumber dari data berstatus <span className="font-mono">official_verified</span>. Klik tombol Mulai untuk memulai sesi.
                  </div>
                  {gameMessages.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto text-xs font-mono bg-slate-950 text-slate-100 p-4 rounded-lg whitespace-pre-wrap">
                      {gameMessages.map((m, i) => (
                        <div key={i} className="pb-2 border-b border-slate-800 last:border-0">{m}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 48Group Leaderboard */}
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Papan Peringkat 48Group Game Center</h3>
              {leaderboard48.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada skor tercatat. Jadilah pemain pertama yang menyelesaikan kuis 48Group!</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {leaderboard48.map((row, idx) => (
                    <div key={`${row.display_name}-${idx}`} className="py-2.5 flex items-center justify-between">
                      <span className="font-medium">{idx + 1}. {row.display_name}</span>
                      <span className="font-mono tabular-nums text-xs text-pink-600 dark:text-pink-400">
                        {row.total_score} pts · {row.total_wins} menang
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
