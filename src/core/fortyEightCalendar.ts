export interface SimpleCalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface CalendarEventSource {
  id: string;
  group_id: string;
  title: string;
  event_type: string;
  event_date: string;
  venue: string;
  summary: string;
  source_url: string;
}

export interface CalendarMemberSource {
  id: string;
  name: string;
  nickname: string;
  group_id: string;
  generation: string;
  status: string;
  birth_date?: string | null;
  source_url: string;
}

export type CalendarItemKind = 'concert' | 'birthday';

export interface CalendarHighlightItem {
  key: string;
  kind: CalendarItemKind;
  title: string;
  subtitle: string;
  groupId: string;
  date: SimpleCalendarDate;
  isoDate: string;
  daysUntil: number;
  sourceUrl: string;
  metaBadge: string;
}

const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatMonthYearId(year: number, month: number): string {
  const name = MONTH_NAMES_ID[(month - 1 + 12) % 12] || '';
  return `${name} ${year}`;
}

export function formatDateShortId(date: SimpleCalendarDate): string {
  const name = (MONTH_NAMES_ID[(date.month - 1 + 12) % 12] || '').slice(0, 3);
  return `${date.day} ${name} ${date.year}`;
}

export function parseIsoDateParts(value: string | null | undefined): SimpleCalendarDate | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function toIsoDateKey(d: SimpleCalendarDate): string {
  const y = String(d.year).padStart(4, '0');
  const m = String(d.month).padStart(2, '0');
  const day = String(d.day).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function diffDaysBetween(from: SimpleCalendarDate, to: SimpleCalendarDate): number {
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export function getNextBirthdayDate(
  birthDate: SimpleCalendarDate,
  reference: SimpleCalendarDate,
): { date: SimpleCalendarDate; daysUntil: number; turningAge: number } {
  const makeDateForYear = (yr: number): SimpleCalendarDate => {
    // Handle Feb 29 safely on non-leap years
    if (birthDate.month === 2 && birthDate.day === 29) {
      const check = new Date(Date.UTC(yr, 1, 29));
      if (check.getUTCMonth() !== 1) {
        return { year: yr, month: 2, day: 28 };
      }
    }
    return { year: yr, month: birthDate.month, day: birthDate.day };
  };

  let candidate = makeDateForYear(reference.year);
  let delta = diffDaysBetween(reference, candidate);
  if (delta < 0) {
    candidate = makeDateForYear(reference.year + 1);
    delta = diffDaysBetween(reference, candidate);
  }
  return {
    date: candidate,
    daysUntil: delta,
    turningAge: candidate.year - birthDate.year,
  };
}

export function getTodayParts(now: Date = new Date()): SimpleCalendarDate {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

export function buildMonthItemsMap(params: {
  year: number;
  month: number;
  events: CalendarEventSource[];
  members: CalendarMemberSource[];
  referenceDate: SimpleCalendarDate;
  filter: 'all' | CalendarItemKind;
}): Map<string, CalendarHighlightItem[]> {
  const { year, month, events, members, referenceDate, filter } = params;
  const map = new Map<string, CalendarHighlightItem[]>();

  const pushItem = (item: CalendarHighlightItem) => {
    const existing = map.get(item.isoDate) ?? [];
    existing.push(item);
    map.set(item.isoDate, existing);
  };

  if (filter === 'all' || filter === 'concert') {
    for (const ev of events) {
      const parsed = parseIsoDateParts(ev.event_date);
      if (!parsed || parsed.year !== year || parsed.month !== month) continue;
      pushItem({
        key: `evt-${ev.id}`,
        kind: 'concert',
        title: ev.title,
        subtitle: `${ev.group_id.toUpperCase()} · ${ev.venue}`,
        groupId: ev.group_id,
        date: parsed,
        isoDate: toIsoDateKey(parsed),
        daysUntil: diffDaysBetween(referenceDate, parsed),
        sourceUrl: ev.source_url,
        metaBadge: ev.event_type,
      });
    }
  }

  if (filter === 'all' || filter === 'birthday') {
    for (const m of members) {
      const birth = parseIsoDateParts(m.birth_date);
      if (!birth || birth.month !== month) continue;
      let dayNum = birth.day;
      if (birth.month === 2 && birth.day === 29) {
        const check = new Date(Date.UTC(year, 1, 29));
        if (check.getUTCMonth() !== 1) dayNum = 28;
      }
      const occDate: SimpleCalendarDate = { year, month, day: dayNum };
      const age = year - birth.year;
      pushItem({
        key: `bday-${m.id}-${year}`,
        kind: 'birthday',
        title: `Ulang Tahun ${m.nickname} (${m.name})`,
        subtitle: `${m.group_id.toUpperCase()} · ${m.generation} · ${m.status}`,
        groupId: m.group_id,
        date: occDate,
        isoDate: toIsoDateKey(occDate),
        daysUntil: diffDaysBetween(referenceDate, occDate),
        sourceUrl: m.source_url,
        metaBadge: age > 0 ? `Ke-${age}` : 'Ulang Tahun',
      });
    }
  }

  return map;
}

export function getUpcomingHighlights(params: {
  events: CalendarEventSource[];
  members: CalendarMemberSource[];
  referenceDate: SimpleCalendarDate;
  filter: 'all' | CalendarItemKind;
  limit?: number;
}): CalendarHighlightItem[] {
  const { events, members, referenceDate, filter, limit = 8 } = params;
  const items: CalendarHighlightItem[] = [];

  if (filter === 'all' || filter === 'concert') {
    for (const ev of events) {
      const parsed = parseIsoDateParts(ev.event_date);
      if (!parsed) continue;
      const daysUntil = diffDaysBetween(referenceDate, parsed);
      if (daysUntil < 0) continue;
      items.push({
        key: `up-evt-${ev.id}`,
        kind: 'concert',
        title: ev.title,
        subtitle: `${ev.group_id.toUpperCase()} · ${ev.venue}`,
        groupId: ev.group_id,
        date: parsed,
        isoDate: toIsoDateKey(parsed),
        daysUntil,
        sourceUrl: ev.source_url,
        metaBadge: ev.event_type,
      });
    }
  }

  if (filter === 'all' || filter === 'birthday') {
    for (const m of members) {
      const birth = parseIsoDateParts(m.birth_date);
      if (!birth) continue;
      const next = getNextBirthdayDate(birth, referenceDate);
      items.push({
        key: `up-bday-${m.id}`,
        kind: 'birthday',
        title: `Ulang Tahun ${m.nickname}`,
        subtitle: `${m.name} · ${m.group_id.toUpperCase()} · ${m.status}`,
        groupId: m.group_id,
        date: next.date,
        isoDate: toIsoDateKey(next.date),
        daysUntil: next.daysUntil,
        sourceUrl: m.source_url,
        metaBadge: next.turningAge > 0 ? `Ke-${next.turningAge}` : 'Ulang Tahun',
      });
    }
  }

  items.sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title));
  return items.slice(0, limit);
}

export interface CalendarGridCell {
  date: SimpleCalendarDate;
  isoDate: string;
  inCurrentMonth: boolean;
}

export function buildMonthGridCells(year: number, month: number): CalendarGridCell[] {
  const firstDayUtc = new Date(Date.UTC(year, month - 1, 1));
  // Convert Sunday=0..Saturday=6 into Monday-first index (Mon=0..Sun=6)
  const leadingBlanks = (firstDayUtc.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  const cells: CalendarGridCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - leadingBlanks + 1;
    const cellDate = new Date(Date.UTC(year, month - 1, dayOffset));
    const d: SimpleCalendarDate = {
      year: cellDate.getUTCFullYear(),
      month: cellDate.getUTCMonth() + 1,
      day: cellDate.getUTCDate(),
    };
    cells.push({
      date: d,
      isoDate: toIsoDateKey(d),
      inCurrentMonth: d.year === year && d.month === month,
    });
  }
  return cells;
}

export function formatCountdownLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Hari Ini';
  if (daysUntil === 1) return 'Besok';
  if (daysUntil > 1) return `H-${daysUntil}`;
  return `${Math.abs(daysUntil)} hari lalu`;
}
