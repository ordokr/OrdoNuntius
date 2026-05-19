import type { CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';
import { generateUUID } from '@/lib/utils';

export interface ParticipantInfo {
  id: string;
  name: string;
  email: string;
  status: CalendarParticipant['participationStatus'];
  isOrganizer: boolean;
}

export interface StatusCounts {
  accepted: number;
  declined: number;
  tentative: number;
  'needs-action': number;
}

/**
 * Check if a participant matches any of the given email addresses.
 * Checks p.email, p.calendarAddress (mailto:...), and p.sendTo values.
 */
// O(1) membership check against the user's emails. Takes a Set to avoid
// per-call `userEmails.includes(...)` walks — the caller builds the Set
// once per outer call (we typically have 1-3 user emails so the Set
// build itself is cheap, but the savings compound per participant).
function participantMatchesEmail(p: CalendarParticipant, lowerEmails: Set<string>): boolean {
  if (p.email && lowerEmails.has(p.email.toLowerCase())) return true;
  if (p.calendarAddress) {
    const addr = p.calendarAddress.replace(/^mailto:/i, '').toLowerCase();
    if (addr && lowerEmails.has(addr)) return true;
  }
  if (p.sendTo) {
    for (const k in p.sendTo) {
      const normalized = p.sendTo[k].replace(/^mailto:/i, '').toLowerCase();
      if (normalized && lowerEmails.has(normalized)) return true;
    }
  }
  return false;
}

function lowerSet(emails: string[]): Set<string> {
  const s = new Set<string>();
  for (const e of emails) s.add(e.toLowerCase());
  return s;
}

export function isOrganizer(event: CalendarEvent, userEmails: string[]): boolean {
  if (!event.participants) return false;
  const lower = lowerSet(userEmails);
  for (const k in event.participants) {
    const p = event.participants[k];
    if (p.roles?.owner && participantMatchesEmail(p, lower)) return true;
  }
  return false;
}

export function getUserParticipantId(event: CalendarEvent, userEmails: string[]): string | null {
  if (!event.participants) return null;
  const lower = lowerSet(userEmails);
  for (const id in event.participants) {
    if (participantMatchesEmail(event.participants[id], lower)) return id;
  }
  return null;
}

export function getUserStatus(
  event: CalendarEvent,
  userEmails: string[]
): CalendarParticipant['participationStatus'] | null {
  if (!event.participants) return null;
  const lower = lowerSet(userEmails);
  for (const k in event.participants) {
    const p = event.participants[k];
    if (participantMatchesEmail(p, lower)) return p.participationStatus;
  }
  return null;
}

export function getParticipantList(event: CalendarEvent): ParticipantInfo[] {
  if (!event.participants) return [];
  return Object.entries(event.participants).map(([id, p]) => {
    let email = p.email || '';
    if (!email && p.calendarAddress) {
      email = p.calendarAddress.replace(/^mailto:/i, '');
    }
    if (!email && p.sendTo?.imip) {
      email = p.sendTo.imip.replace(/^mailto:/i, '');
    }
    return {
      id,
      name: p.name || '',
      email,
      status: p.participationStatus || 'needs-action',
      isOrganizer: !!p.roles?.owner,
    };
  });
}

export function getStatusCounts(event: CalendarEvent): StatusCounts {
  const counts: StatusCounts = { accepted: 0, declined: 0, tentative: 0, 'needs-action': 0 };
  if (!event.participants) return counts;
  for (const k in event.participants) {
    const s = event.participants[k].participationStatus || 'needs-action';
    if (s in counts) counts[s as keyof StatusCounts]++;
  }
  return counts;
}

export function getParticipantCount(event: CalendarEvent): number {
  if (!event.participants) return 0;
  return Object.keys(event.participants).length;
}

export function buildParticipantMap(
  organizer: { name: string; email: string },
  attendees: { name: string; email: string }[]
): Record<string, Partial<CalendarParticipant>> {
  const participants: Record<string, Partial<CalendarParticipant>> = {};

  const generateId = () => generateUUID();

  participants[generateId()] = {
    '@type': 'Participant',
    name: organizer.name,
    email: organizer.email,
    calendarAddress: `mailto:${organizer.email}`,
    roles: { owner: true, attendee: true },
    participationStatus: 'accepted',
    scheduleAgent: 'server',
    sendTo: { imip: `mailto:${organizer.email}` },
    expectReply: false,
    kind: 'individual',
  };

  attendees.forEach((a) => {
    participants[generateId()] = {
      '@type': 'Participant',
      name: a.name,
      email: a.email,
      calendarAddress: `mailto:${a.email}`,
      roles: { attendee: true },
      participationStatus: 'needs-action',
      scheduleAgent: 'server',
      sendTo: { imip: `mailto:${a.email}` },
      expectReply: true,
      kind: 'individual',
    };
  });

  return participants;
}
