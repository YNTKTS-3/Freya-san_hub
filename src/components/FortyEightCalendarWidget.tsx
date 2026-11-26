import React, { useMemo, useState } from 'react';
import { Cake, Calendar, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import {
  buildMonthGridCells,
  buildMonthItemsMap,
  CalendarEventSource,
  CalendarHighlightItem,
  CalendarItemKind,
  CalendarMemberSource,
  formatCountdownLabel,
  formatDateShortId,
  formatMonthYearId,
  getTodayParts,
  getUpcomingHighlights,
  SimpleCalendarDate,
  toIsoDateKey,
} from '../core/fortyEightCalendar';

interface FortyEightCalendarWidgetProps {
  events: CalendarEventSource[];
  members: CalendarMemberSource[];
  onOpenEventsTab?: () => void;
}

const WEEKDAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export const FortyEightCalendarWidget: React.FC<FortyEightCalendarWidgetProps> = ({
  events,
  members,
  onOpenEventsTab,
}) => {
  const today = useMemo(() => getTodayParts(), []);
  const todayKey = toIsoDateKey(today);

  const [viewYear, setViewYear] = useState<number>(today.year);
  const [viewMonth, setViewMonth] = useState<number>(today.month);
  const [selectedDate, setSelectedDate] = useState<SimpleCalendarDate>(today);
  const [filter, setFilter] = useState<'all' | CalendarItemKind>('all');

  const gridCells = useMemo(() => buildMonthGridCells(viewYear, viewMonth), [viewYear, viewMonth]);

  const monthItemsMap = useMemo(
    () =>
      buildMonthItemsMap({
        year: viewYear,
        month: viewMonth,
        events,
        members,
        referenceDate: today,
        filter,
      }),
    [viewYear, viewMonth, events, members, today, filter],
  );

  const upcomingItems = useMemo(
    () =>
      getUpcomingHighlights({
        events,
        members,
        referenceDate: today,
        filter,
        limit: 5,
      }),
    [events, members, today, filter],
  );

  const selectedKey = toIsoDateKey(selectedDate);
  const selectedDayItems = useMemo(() => {
    if (selectedDate.year === viewYear && selectedDate.month === viewMonth) {
      return monthItemsMap.get(selectedKey) ?? [];
    }
    const selMap = buildMonthItemsMap({
      year: selectedDate.year,
      month: selectedDate.month,
      events,
      members,
      referenceDate: today,
      filter,
    });
    return selMap.get(selectedKey) ?? [];
  }, [selectedDate, selectedKey, viewYear, viewMonth, monthItemsMap, events, members, today, filter]);

  const monthHighlightCount = useMemo(() => {
    let total = 0;
    monthItemsMap.forEach((list) => {
      total += list.length;
    });
    return total;
  }, [monthItemsMap]);

  const stepMonth = (delta: number) => {
    const next = new Date(Date.UTC(viewYear, viewMonth - 1 + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth() + 1);
  };

  const jumpToDate = (d: SimpleCalendarDate) => {
    setViewYear(d.year);
    setViewMonth(d.month);
    setSelectedDate(d);
  };

  const nextUpcoming = upcomingItems[0] ?? null;

  return (
    <section
      aria-label="Kalender Konser & Ulang Tahun Member 48Group"
      className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden"
    >
      {/* Top Widget Bar */}
      <div className="px-5 py-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
            Kalender Jadwal & Ulang Tahun 48Group
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            {upcomingItems.length} agenda mendatang terverifikasi · Konser, anniversary grup & ulang tahun member
          </p>
        </div>

        <div
          role="group"
          aria-label="Filter jenis agenda kalender"
          className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-full sm:w-auto"
        >
          {(
            [
              { id: 'all', label: 'Semua' },
              { id: 'concert', label: 'Konser & Event' },
              { id: 'birthday', label: 'Ulang Tahun' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilter(opt.id)}
              className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                filter === opt.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        {/* Left: Monthly Interactive Calendar */}
        <div className="lg:col-span-7 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
              {formatMonthYearId(viewYear, viewMonth)}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Bulan sebelumnya"
                onClick={() => stepMonth(-1)}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => jumpToDate(today)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Hari Ini
              </button>
              <button
                type="button"
                aria-label="Bulan berikutnya"
                onClick={() => stepMonth(1)}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((day) => (
              <div
                key={day}
                className="py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              >
                {day}
              </div>
            ))}

            {gridCells.map((cell) => {
              const items = cell.inCurrentMonth ? monthItemsMap.get(cell.isoDate) ?? [] : [];
              const hasConcert = items.some((i) => i.kind === 'concert');
              const hasBirthday = items.some((i) => i.kind === 'birthday');
              const isSelected = cell.isoDate === selectedKey;
              const isToday = cell.isoDate === todayKey;

              let cellSurface =
                'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200';

              if (!cell.inCurrentMonth) {
                cellSurface =
                  'border-transparent text-slate-300 dark:text-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40';
              } else if (isSelected) {
                cellSurface =
                  'border-slate-900 dark:border-white bg-slate-900 dark:bg-white text-white dark:text-slate-900';
              } else if (hasConcert && hasBirthday) {
                cellSurface =
                  'border-pink-300 dark:border-pink-700 bg-pink-50 dark:bg-pink-950/50 text-slate-900 dark:text-white';
              } else if (hasConcert) {
                cellSurface =
                  'border-pink-200 dark:border-pink-800/80 bg-pink-50/80 dark:bg-pink-950/40 text-pink-900 dark:text-pink-100';
              } else if (hasBirthday) {
                cellSurface =
                  'border-blue-200 dark:border-blue-800/80 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100';
              }

              return (
                <button
                  key={cell.isoDate}
                  type="button"
                  onClick={() => jumpToDate(cell.date)}
                  aria-label={`${formatDateShortId(cell.date)}${items.length > 0 ? `, ${items.length} agenda` : ''}`}
                  className={`min-h-[46px] sm:min-h-[50px] p-1 rounded-lg border flex flex-col items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${cellSurface} ${
                    isToday && !isSelected ? 'ring-1 ring-slate-400 dark:ring-slate-500' : ''
                  }`}
                >
                  <span className="text-xs font-semibold tabular-nums leading-none mt-0.5">
                    {cell.date.day}
                  </span>
                  <div className="flex items-center gap-0.5 min-h-[14px]">
                    {hasConcert && (
                      <Calendar
                        aria-hidden="true"
                        className={`w-3 h-3 ${
                          isSelected ? 'text-pink-300 dark:text-pink-600' : 'text-pink-600 dark:text-pink-400'
                        }`}
                      />
                    )}
                    {hasBirthday && (
                      <Cake
                        aria-hidden="true"
                        className={`w-3 h-3 ${
                          isSelected ? 'text-blue-300 dark:text-blue-600' : 'text-blue-600 dark:text-blue-400'
                        }`}
                      />
                    )}
                    {!hasConcert && !hasBirthday && isToday && (
                      <span className="text-[9px] font-medium leading-none opacity-75">Kini</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {monthHighlightCount === 0 && nextUpcoming && (
            <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
              <span>Belum ada agenda bertanggal tetap di bulan ini.</span>
              <button
                type="button"
                onClick={() => jumpToDate(nextUpcoming.date)}
                className="font-semibold text-pink-600 dark:text-pink-400 hover:underline whitespace-nowrap shrink-0"
              >
                Lompat ke terdekat ({formatDateShortId(nextUpcoming.date)})
              </button>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Calendar aria-hidden="true" className="w-3.5 h-3.5 text-pink-600 dark:text-pink-400" />
              Konser / Anniversary Resmi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Cake aria-hidden="true" className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              Ulang Tahun Member
            </span>
          </div>
        </div>

        {/* Right: Selected Day + Upcoming Highlights */}
        <div className="lg:col-span-5 p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="space-y-5">
            {/* Selected Date Detail */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Agenda Tanggal Terpilih
                </h3>
                <span className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                  {formatDateShortId(selectedDate)}
                </span>
              </div>

              {selectedDayItems.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2 border-b border-slate-100 dark:border-slate-800">
                  Nggak ada konser terjadwal atau ulang tahun member di tanggal ini. Klik tanggal yang bertanda atau pilih sorotan mendatang di bawah.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800">
                  {selectedDayItems.map((item) => (
                    <div key={item.key} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {item.kind === 'concert' ? (
                          <Calendar
                            aria-hidden="true"
                            className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0 mt-0.5"
                          />
                        ) : (
                          <Cake
                            aria-hidden="true"
                            className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                            {item.title}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {item.subtitle} · {item.metaBadge}
                          </div>
                        </div>
                      </div>
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Sumber resmi ${item.title}`}
                        className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        Sumber <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Sorotan Mendatang
                </h3>
                <span className="text-xs text-slate-400 tabular-nums">
                  {upcomingItems.length} terdekat
                </span>
              </div>

              {upcomingItems.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Belum ada jadwal mendatang yang sesuai filter aktif.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {upcomingItems.map((item: CalendarHighlightItem) => {
                    const isActive = item.isoDate === selectedKey;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => jumpToDate(item.date)}
                        className={`w-full py-2.5 px-2 -mx-2 rounded-lg text-left flex items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                          isActive
                            ? 'bg-slate-100 dark:bg-slate-800/80'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {item.kind === 'concert' ? (
                            <Calendar
                              aria-hidden="true"
                              className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0"
                            />
                          ) : (
                            <Cake
                              aria-hidden="true"
                              className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {formatDateShortId(item.date)} · {item.groupId.toUpperCase()} · {item.metaBadge}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-mono font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                            item.kind === 'concert'
                              ? 'text-pink-600 dark:text-pink-400'
                              : 'text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          {formatCountdownLabel(item.daysUntil)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {onOpenEventsTab && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Jadwal teater rutin tersedia di arsip event
              </span>
              <button
                type="button"
                onClick={onOpenEventsTab}
                className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
              >
                Buka Event & Calendar →
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
