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

export interface EventParticipantSummary {
  list: ParticipantInfo[];
  statusCounts: StatusCounts;
  organizerInfo: { name: string; email: string } | null;
}

// Fused single-walk replacement for getParticipantList + getStatusCounts +
// `participants.find(p => p.isOrganizer)`. Event-modal + event-detail-popover
// previously walked event.participants 3 times (once per useMemo); this folds
// them into one pass — ~3× speedup on the participants-heavy render path.
export function getEventParticipantSummary(event: CalendarEvent): EventParticipantSummary {
  const counts: StatusCounts = { accepted: 0, declined: 0, tentative: 0, 'needs-action': 0 };
  if (!event.participants) return { list: [], statusCounts: counts, organizerInfo: null };
  const list: ParticipantInfo[] = [];
  let organizerInfo: { name: string; email: string } | null = null;
  for (const id in event.participants) {
    const p = event.participants[id];
    let email = p.email || '';
    if (!email && p.calendarAddress) email = p.calendarAddress.replace(/^mailto:/i, '');
    if (!email && p.sendTo?.imip) email = p.sendTo.imip.replace(/^mailto:/i, '');
    const status = p.participationStatus || 'needs-action';
    const isOrg = !!p.roles?.owner;
    list.push({ id, name: p.name || '', email, status, isOrganizer: isOrg });
    if (status in counts) counts[status as keyof StatusCounts]++;
    if (isOrg && !organizerInfo) organizerInfo = { name: p.name || '', email };
  }
  return { list, statusCounts: counts, organizerInfo };
}

export interface UserParticipantInfo {
  isOrganizer: boolean;
  participantId: string | null;
  status: CalendarParticipant['participationStatus'] | null;
}

// Fused single-walk replacement for isOrganizer + getUserParticipantId +
// getUserStatus. Three useMemos in event-modal/event-detail-popover that each
// called one of these now share one pass — and one lowerSet build instead of three.
export function getUserParticipantInfo(event: CalendarEvent, userEmails: string[]): UserParticipantInfo {
  if (!event.participants) return { isOrganizer: false, participantId: null, status: null };
  const lower = lowerSet(userEmails);
  let isOrg = false;
  let participantId: string | null = null;
  let status: CalendarParticipant['participationStatus'] | null = null;
  for (const id in event.participants) {
    const p = event.participants[id];
    if (!participantMatchesEmail(p, lower)) continue;
    if (participantId === null) {
      participantId = id;
      status = p.participationStatus;
    }
    if (p.roles?.owner) {
      isOrg = true;
      break;
    }
  }
  return { isOrganizer: isOrg, participantId, status };
}

export function getParticipantCount(event: CalendarEvent): number {
  if (!event.participants) return 0;
  // for...in count avoids the `Object.keys(...).length` keys-array
  // allocation. Called per event in EventCard render (every calendar
  // tile in every view).
  let n = 0;
  for (const _ in event.participants) n++;
  return n;
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
