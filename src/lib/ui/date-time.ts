import { currentLocale, t } from '#lib/i18n.js';
import { preferences } from '#lib/settings/preferences.svelte.js';

import { SYSTEM_TIME_ZONE } from './time-zones.js';

function zone(): { timeZone?: string } {
  return preferences.timeZone === SYSTEM_TIME_ZONE ? {} : { timeZone: preferences.timeZone };
}

interface Day {
  year: number;
  month: number;
  day: number;
}

let dayFormat: { zone: string; format: Intl.DateTimeFormat } | undefined;

function dayFormatter(): Intl.DateTimeFormat {
  const zoneName = preferences.timeZone;
  if (dayFormat?.zone !== zoneName) {
    dayFormat = {
      zone: zoneName,
      format: new Intl.DateTimeFormat('en-US', {
        ...zone(),
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }),
    };
  }
  return dayFormat.format;
}

function dayOf(date: Date): Day {
  const parts = dayFormatter().formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function dayBefore({ year, month, day }: Day): Day {
  const before = new Date(Date.UTC(year, month - 1, day - 1));
  return {
    year: before.getUTCFullYear(),
    month: before.getUTCMonth() + 1,
    day: before.getUTCDate(),
  };
}

function isSameDay(a: Day, b: Day): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(currentLocale(), {
    ...zone(),
    hour: '2-digit',
    minute: '2-digit',
    ...(preferences.hour24Clock ? { hour12: false } : {}),
  });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatMessageDatePart(date: Date, includeYear: boolean): string {
  return date.toLocaleDateString(currentLocale(), {
    ...zone(),
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

export function formatMessageTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const day = dayOf(date);
  const today = dayOf(new Date());
  const time = formatTime(timestamp);

  if (isSameDay(day, today)) return time;

  if (isSameDay(day, dayBefore(today))) {
    return t('timeline.messageTimestamp', { date: t('common.yesterday'), time });
  }

  const datePart = formatMessageDatePart(date, day.year !== today.year);
  return t('timeline.messageTimestamp', { date: datePart, time });
}

export function formatFullTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(currentLocale(), {
    ...zone(),
    dateStyle: 'full',
    timeStyle: 'medium',
    ...(preferences.hour24Clock ? { hour12: false } : {}),
  });
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = dayOf(date);
  const today = dayOf(new Date());
  if (isSameDay(day, today)) return t('common.today');
  if (isSameDay(day, dayBefore(today))) return t('common.yesterday');

  switch (preferences.dateFormat) {
    case 'dmy':
      return `${pad(day.day)}/${pad(day.month)}/${String(day.year)}`;
    case 'mdy':
      return `${pad(day.month)}/${pad(day.day)}/${String(day.year)}`;
    case 'ymd':
      return `${String(day.year)}-${pad(day.month)}-${pad(day.day)}`;
    default:
      return date.toLocaleDateString(currentLocale(), {
        ...zone(),
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
  }
}
