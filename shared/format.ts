const oneDecimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const longDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const weekdayDate = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export function formatKm(km: number): string {
  return `${oneDecimal.format(km)} km`;
}

export function formatElevationGain(meters: number): string {
  return `${integer.format(meters)} m D+`;
}

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Heure après `minutes`, avec « +1 j » quand elle passe minuit. */
export function formatTimeAfter(time: string, minutes: number): string {
  const [hours = 0, mins = 0] = time.split(':').map(Number);
  const total = hours * 60 + mins + Math.round(minutes);
  const days = Math.floor(total / 1440);
  const rest = total % 1440;
  const clock = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
  return days > 0 ? `${clock} (+${days} j)` : clock;
}

export function formatClock(minutes: number): string {
  return formatTimeAfter('00:00', minutes);
}

export function formatDay(isoDate: string): string {
  return weekdayDate.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (startDate === endDate) return longDate.format(end);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${(sameYear ? dayMonth : longDate).format(start)} → ${longDate.format(end)}`;
}

export function formatDayCount(count: number): string {
  return count > 1 ? `${count} jours` : '1 jour';
}
