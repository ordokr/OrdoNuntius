/* eslint-disable */
// Mock data — broad enough to surface every backend capability

const TAGS = [
  { id: 't.work', name: 'Work', color: 'var(--t-blue)' },
  { id: 't.urgent', name: 'Urgent', color: 'var(--t-red)' },
  { id: 't.finance', name: 'Finance', color: 'var(--t-green)' },
  { id: 't.review', name: 'Review', color: 'var(--t-violet)' },
  { id: 't.travel', name: 'Travel', color: 'var(--t-teal)' },
  { id: 't.personal', name: 'Personal', color: 'var(--t-pink)' },
  { id: 't.followup', name: 'Follow up', color: 'var(--t-amber)' },
  { id: 't.archive', name: 'Reference', color: 'var(--t-slate)' },
];

const ACCOUNTS = [
  { id: 'a.salt', name: 'Salt & Light', email: 'aurelia@saltnlightllc.com', avatar: '#3F3F46', primary: true },
  { id: 'a.epist', name: 'OrdoEpistola', email: 'a.tertius@ordo.lab', avatar: '#7C3AED' },
  { id: 'a.uni', name: 'Universitas', email: 'a.tertius@scholastica.edu', avatar: '#15803D' },
];

const IDENTITIES = [
  { id: 'i.aurelia', from: 'Aurelia Tertius', email: 'aurelia@saltnlightllc.com', signature: '— Aurelia · Salt & Light LLC', accountId: 'a.salt' },
  { id: 'i.tribunal', from: 'Aurelia (Tribunal)', email: 'tribunal@saltnlightllc.com', signature: '— A. Tertius, Tribunal of Records', accountId: 'a.salt' },
  { id: 'i.ordo', from: 'Aurelia Tertius', email: 'a.tertius@ordo.lab', signature: '— Aurelia · OrdoEpistola lab', accountId: 'a.epist' },
];

const FOLDERS = [
  { id: 'f.inbox', name: 'Inbox', icon: 'inbox', count: 12, unread: 4, system: true },
  { id: 'f.starred', name: 'Starred', icon: 'star', count: 9, unread: 0, system: true },
  { id: 'f.snoozed', name: 'Snoozed', icon: 'snooze', count: 3, unread: 0, system: true },
  { id: 'f.sent', name: 'Sent', icon: 'send', count: 412, unread: 0, system: true },
  { id: 'f.drafts', name: 'Drafts', icon: 'drafts', count: 2, unread: 2, system: true },
  { id: 'f.archive', name: 'Archive', icon: 'archive', count: 1842, unread: 0, system: true },
  { id: 'f.junk', name: 'Junk', icon: 'spam', count: 31, unread: 12, system: true },
  { id: 'f.trash', name: 'Trash', icon: 'trash', count: 8, unread: 0, system: true },
];

const CUSTOM_FOLDERS = [
  { id: 'f.c.invoices', name: 'Invoices', icon: 'briefcase', count: 47, unread: 1 },
  { id: 'f.c.lab', name: 'Lab notes', icon: 'cube', count: 23, unread: 0 },
  { id: 'f.c.travel', name: 'Travel', icon: 'globe', count: 14, unread: 0 },
  { id: 'f.c.recs', name: 'Recordings', icon: 'video', count: 6, unread: 0 },
];

const SAVED_SEARCHES = [
  { id: 's.weekattn', name: 'This week — attention', icon: 'zap', q: 'in:inbox newer:7d (from:team OR has:imip)' },
  { id: 's.unread7', name: 'Unread > 7 days', icon: 'clock', q: 'is:unread older:7d' },
  { id: 's.smime', name: 'Signed (S/MIME)', icon: 'shieldCheck', q: 'has:smime' },
  { id: 's.large', name: 'Over 5 MB', icon: 'paperclip', q: 'larger:5M' },
];

// Avatars use a small palette
const AV = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316', '#84CC16'];
function avFor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}
function initials(name) {
  const parts = name.replace(/[<>"].*?@.*$/, '').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const NOW = new Date('2026-05-14T10:42:00').getTime();
const min = (n) => NOW - n * 60 * 1000;
const hr = (n) => NOW - n * 60 * 60 * 1000;
const day = (n) => NOW - n * 24 * 60 * 60 * 1000;

// Threads (conversations)
const THREADS = [
  {
    id: 'th.1',
    subject: 'Q2 procurement — three quotes for the lab build',
    folder: 'f.inbox',
    unread: true,
    starred: true,
    pinned: true,
    tags: ['t.work', 't.finance', 't.urgent'],
    important: true,
    hasAttachment: true,
    smime: 'signed',
    snippet: 'Three vendor bids attached for the email-lab rack rebuild. Capex breakdown in the spreadsheet — the Dell one is over budget by 11%, but…',
    participants: ['Marcus Volusianus', 'Aurelia Tertius', 'Lena Brandt'],
    messages: [
      {
        id: 'm.1.1', from: 'Marcus Volusianus', fromEmail: 'marcus@saltnlightllc.com',
        to: ['Aurelia Tertius <aurelia@saltnlightllc.com>'], cc: ['Lena Brandt <lena@saltnlightllc.com>'],
        date: min(7), smime: { verified: true, signer: 'marcus@saltnlightllc.com', issuer: 'Salt & Light Internal CA' },
        spf: 'pass', dkim: 'pass', dmarc: 'pass',
        body: `Hi Aurelia,

I've collected the three vendor quotes for the email-lab rack rebuild. Summary up top, full PDFs attached and signed; the spreadsheet has the per-line capex breakdown.

• **Dell PowerEdge config** — €48,900. Over budget by 11%. Best NVMe density.
• **Supermicro** — €41,200. On budget. Mid-tier IPMI; we'd accept the limits.
• **Refurbished HPE** — €31,800. 14% below; 24-month warranty only.

I'd lean Supermicro: it threads our €44k cap and the IPMI gap doesn't actually hurt OrdoEpistola's metrics path. Want to lock that in before Friday's procurement window?

— Marcus`,
        attachments: [
          { name: 'Vendor-Quotes-2026Q2.pdf', size: '4.2 MB', kind: 'pdf' },
          { name: 'capex-breakdown.xlsx', size: '186 KB', kind: 'sheet' },
          { name: 'rack-elevation.png', size: '912 KB', kind: 'image' },
        ],
      },
    ],
  },
  {
    id: 'th.2',
    subject: 'Re: Sprint 47 — postmortem on the JMAP push regression',
    folder: 'f.inbox',
    unread: true,
    tags: ['t.work', 't.review'],
    threadCount: 5,
    snippet: 'Looks good — I added a footnote about the LFU cache eviction we saw on the staging instance. Can you double-check the math on page 3?',
    participants: ['Lena Brandt', 'Niko Achterberg', 'Aurelia Tertius'],
    messages: [
      { id: 'm.2.1', from: 'Lena Brandt', date: hr(2), body: 'See attached.' },
    ],
  },
  {
    id: 'th.3',
    subject: 'Invitation: OrdoEpistola architecture review — Thu 16 May, 14:00 CEST',
    folder: 'f.inbox',
    unread: true,
    tags: ['t.work'],
    hasAttachment: true,
    imip: true,
    snippet: 'You are invited to the architecture review for OrdoEpistola v0.4. Agenda attached. Please RSVP by Wed EOD.',
    participants: ['calendar@ordo.lab', 'Lena Brandt', 'Marcus Volusianus'],
    messages: [
      {
        id: 'm.3.1', from: 'Niko Achterberg', fromEmail: 'niko@ordo.lab',
        to: ['arch-review@ordo.lab'], date: hr(4),
        body: 'You are invited to the OrdoEpistola v0.4 architecture review.',
        invite: {
          title: 'OrdoEpistola v0.4 — architecture review',
          start: 'Thu, 16 May 2026 · 14:00 CEST',
          end: '15:30 CEST',
          location: 'meet.ordo.lab/room/epistola-arch',
          organizer: 'Niko Achterberg',
          attendees: [
            { name: 'Aurelia Tertius', status: 'pending', me: true },
            { name: 'Lena Brandt', status: 'accepted' },
            { name: 'Marcus Volusianus', status: 'accepted' },
            { name: 'Élise Moreau', status: 'tentative' },
            { name: 'Niko Achterberg', status: 'organizer' },
          ],
          description: 'JMAP x: extensions, BlockedIp surface, multi-tenant Sieve store.',
        },
      },
    ],
  },
  {
    id: 'th.4',
    subject: 'Re: Tribunal of Records — quarterly attestation due 31 May',
    folder: 'f.inbox',
    unread: false,
    starred: true,
    tags: ['t.work', 't.urgent'],
    snippet: "Reminder — Q2 attestation packet is due 31 May. I've drafted the SOC2-adjacent section; please review the SPF/DKIM/DMARC compliance table.",
    participants: ['Compliance bot', 'Aurelia Tertius'],
    messages: [{ id: 'm.4.1', from: 'Compliance bot', date: hr(7), body: '...' }],
  },
  {
    id: 'th.5',
    subject: 'Booking confirmed — Hotel Aleph, Roma, 22-25 Jun',
    folder: 'f.inbox',
    unread: false,
    tags: ['t.travel', 't.personal'],
    hasAttachment: true,
    snippet: 'Your reservation is confirmed. Check-in Mon 22 Jun, check-out Wed 25 Jun. Reservation reference HA-2026-44871.',
    participants: ['Hotel Aleph'],
    messages: [{ id: 'm.5.1', from: 'Hotel Aleph', date: hr(11), body: '...' }],
  },
  {
    id: 'th.6',
    subject: '[GitHub] PR #214 merged: feat(sieve) raw editor syntax linting',
    folder: 'f.inbox',
    unread: false,
    tags: ['t.work'],
    snippet: 'Your pull request #214 has been merged into main by @niko. CI on main is green.',
    participants: ['GitHub'],
    messages: [{ id: 'm.6.1', from: 'GitHub', date: hr(14), body: '...' }],
  },
  {
    id: 'th.7',
    subject: 'Newsletter — Latin Lapidary Weekly, Issue 174',
    folder: 'f.inbox',
    unread: false,
    tags: ['t.personal'],
    snippet: 'This week: inscriptions from the Via Appia, a new transcription of CIL VI 1283, and a reader letter on cursus publicus.',
    participants: ['Latin Lapidary'],
    messages: [{ id: 'm.7.1', from: 'Latin Lapidary', date: hr(20), body: '...' }],
  },
  {
    id: 'th.8',
    subject: 'Re: Encrypted: client engagement letter (signed)',
    folder: 'f.inbox',
    unread: false,
    starred: true,
    tags: ['t.work', 't.finance'],
    smime: 'encrypted',
    snippet: 'Encrypted message. Signed by clemens@volusianus-partner.example. Decrypted in this client.',
    participants: ['Clemens Volusianus'],
    messages: [{ id: 'm.8.1', from: 'Clemens Volusianus', date: day(1), body: '...' }],
  },
  {
    id: 'th.9',
    subject: 'Salt & Light — payroll preview (May)',
    folder: 'f.inbox',
    unread: false,
    tags: ['t.finance'],
    snippet: 'May payroll preview is ready for your review. Two new identities, one off-cycle bonus pending approval.',
    participants: ['Payroll'],
    messages: [{ id: 'm.9.1', from: 'Payroll', date: day(1), body: '...' }],
  },
  {
    id: 'th.10',
    subject: 'Re: vCard import — 312 contacts, 14 duplicates flagged',
    folder: 'f.inbox',
    unread: false,
    tags: ['t.archive'],
    hasAttachment: true,
    snippet: 'Import complete. 298 new contacts added to "Salt & Light directory"; 14 duplicates ready for your review.',
    participants: ['OrdoNuntius'],
    messages: [{ id: 'm.10.1', from: 'OrdoNuntius', date: day(2), body: '...' }],
  },
  {
    id: 'th.11',
    subject: 'Élise — Notes from the architecture sync (with audio)',
    folder: 'f.inbox',
    unread: false,
    tags: ['t.work', 't.review'],
    hasAttachment: true,
    snippet: 'Sharing the audio capture and my synthesis notes from yesterday\'s OrdoEpistola sync. Three open questions at the bottom.',
    participants: ['Élise Moreau'],
    messages: [{ id: 'm.11.1', from: 'Élise Moreau', date: day(2), body: '...' }],
  },
  {
    id: 'th.12',
    subject: 'Security alert — new device signed in from Roma, IT',
    folder: 'f.inbox',
    unread: false,
    important: true,
    tags: ['t.urgent'],
    snippet: 'A new device (Safari · macOS 15.4) signed in to your account from Roma, Italy. Was this you?',
    participants: ['OrdoNuntius Security'],
    messages: [{ id: 'm.12.1', from: 'OrdoNuntius Security', date: day(3), body: '...' }],
  },
];

// Other modules
const EVENTS = [
  { id: 'e.1', title: 'OrdoEpistola arch review', start: '2026-05-16T14:00', end: '2026-05-16T15:30', color: 'var(--t-violet)', cal: 'Lab', location: 'meet.ordo.lab', imip: true },
  { id: 'e.2', title: '1:1 with Marcus', start: '2026-05-14T15:00', end: '2026-05-14T15:30', color: 'var(--t-blue)', cal: 'Work' },
  { id: 'e.3', title: 'Procurement window closes', start: '2026-05-15T17:00', end: '2026-05-15T17:30', color: 'var(--t-red)', cal: 'Work', allDay: false },
  { id: 'e.4', title: 'Roma trip', start: '2026-05-22T00:00', end: '2026-05-25T23:59', color: 'var(--t-teal)', cal: 'Personal', allDay: true },
  { id: 'e.5', title: 'Quarterly attestation due', start: '2026-05-31T23:59', end: '2026-05-31T23:59', color: 'var(--t-amber)', cal: 'Compliance', allDay: true },
  { id: 'e.6', title: 'Lena — sprint 47 demo', start: '2026-05-19T11:00', end: '2026-05-19T12:00', color: 'var(--t-blue)', cal: 'Work' },
  { id: 'e.7', title: 'Latin reading group', start: '2026-05-21T19:00', end: '2026-05-21T20:30', color: 'var(--t-pink)', cal: 'Personal' },
];

const CONTACTS = [
  { id: 'c.1', name: 'Marcus Volusianus', email: 'marcus@saltnlightllc.com', phone: '+39 06 4470 1212', org: 'Salt & Light LLC', role: 'Director, Lab Ops', book: 'Salt & Light', favorite: true, trusted: true },
  { id: 'c.2', name: 'Lena Brandt', email: 'lena@saltnlightllc.com', phone: '+49 30 5577 0011', org: 'Salt & Light LLC', role: 'Principal Engineer', book: 'Salt & Light', favorite: true, trusted: true },
  { id: 'c.3', name: 'Niko Achterberg', email: 'niko@ordo.lab', phone: '+31 20 555 4421', org: 'OrdoEpistola', role: 'Maintainer', book: 'OrdoEpistola', trusted: true },
  { id: 'c.4', name: 'Élise Moreau', email: 'elise@ordo.lab', phone: '+33 1 4477 8801', org: 'OrdoEpistola', role: 'Researcher', book: 'OrdoEpistola', trusted: true },
  { id: 'c.5', name: 'Clemens Volusianus', email: 'clemens@volusianus-partner.example', org: 'Volusianus & Partner', role: 'Counsel', book: 'External', trusted: true },
  { id: 'c.6', name: 'Sophie Müller', email: 'sophie@eurotech.example', org: 'Eurotech', role: 'Partner Lead', book: 'External' },
  { id: 'c.7', name: 'Liam Ó Donaill', email: 'liam@odonaill.example', org: 'Independent', role: 'Consultant', book: 'External' },
  { id: 'c.8', name: 'Booking.com', email: 'noreply@booking.example', org: 'Booking', book: 'External' },
  { id: 'c.9', name: 'Latin Lapidary', email: 'newsletter@latinlapidary.example', org: 'Newsletter', book: 'External' },
];

const FILES = [
  { id: 'fl.1', name: 'Vendor-Quotes-2026Q2.pdf', size: '4.2 MB', kind: 'pdf', mtime: 'just now', shared: false, color: 'var(--t-red)' },
  { id: 'fl.2', name: 'capex-breakdown.xlsx', size: '186 KB', kind: 'sheet', mtime: '7 min', shared: false, color: 'var(--t-green)' },
  { id: 'fl.3', name: 'rack-elevation.png', size: '912 KB', kind: 'image', mtime: '7 min', shared: false, color: 'var(--t-violet)' },
  { id: 'fl.4', name: 'Tribunal Q1 attestation.pdf', size: '1.1 MB', kind: 'pdf', mtime: '2 d', shared: true, color: 'var(--t-red)' },
  { id: 'fl.5', name: 'OrdoEpistola-architecture.draw.svg', size: '88 KB', kind: 'image', mtime: '3 d', shared: true, color: 'var(--t-violet)' },
  { id: 'fl.6', name: 'arch-sync-audio.m4a', size: '14.2 MB', kind: 'audio', mtime: '3 d', shared: false, color: 'var(--t-amber)' },
  { id: 'fl.7', name: 'engagement-letter-signed.pdf', size: '742 KB', kind: 'pdf', mtime: '4 d', shared: true, color: 'var(--t-red)' },
  { id: 'fl.8', name: 'CIL-VI-1283-transcription.md', size: '12 KB', kind: 'text', mtime: '6 d', shared: false, color: 'var(--t-slate)' },
];

const FILE_FOLDERS = [
  { id: 'ff.1', name: 'Documents', count: 142, color: 'var(--t-blue)' },
  { id: 'ff.2', name: 'Lab', count: 38, color: 'var(--t-violet)' },
  { id: 'ff.3', name: 'Tribunal', count: 24, color: 'var(--t-red)' },
  { id: 'ff.4', name: 'Recordings', count: 6, color: 'var(--t-amber)' },
];

// Sieve filters (visual rule cards)
const FILTERS_LIST = [
  {
    id: 'sv.1', name: 'Auto-tag Tribunal', enabled: true, hits: 47,
    when: [{ field: 'From', op: 'contains', val: '@tribunal.saltnlightllc.com' }],
    then: [{ kind: 'tag', val: 'Work' }, { kind: 'tag', val: 'Urgent' }, { kind: 'star' }],
  },
  {
    id: 'sv.2', name: 'GitHub notifications → Lab folder', enabled: true, hits: 312,
    when: [{ field: 'From', op: 'equals', val: 'notifications@github.com' }],
    then: [{ kind: 'move', val: 'Lab notes' }, { kind: 'mark-read' }],
  },
  {
    id: 'sv.3', name: 'Big PDFs from Volusianus → Invoices', enabled: true, hits: 28,
    when: [
      { field: 'From', op: 'contains', val: '@volusianus' },
      { field: 'Size', op: 'greater', val: '1MB' },
      { field: 'Attachment', op: 'contains', val: '.pdf' },
    ],
    then: [{ kind: 'move', val: 'Invoices' }, { kind: 'tag', val: 'Finance' }],
  },
  {
    id: 'sv.4', name: 'Marketing → Junk if unread > 7 d', enabled: false, hits: 0,
    when: [{ field: 'List-Id', op: 'contains', val: 'newsletter' }, { field: 'Age', op: 'older', val: '7d' }],
    then: [{ kind: 'move', val: 'Junk' }],
  },
];

const TEMPLATES = [
  { id: 'tp.1', name: 'Tribunal — Receipt of attestation', body: 'Dear {{recipientName}},\n\nI confirm receipt of your Q{{quarter}} attestation packet. We will respond by {{date+5d}}.' },
  { id: 'tp.2', name: 'Procurement — Quote requested', body: 'Hello {{recipientName}},\n\nWe are evaluating vendors for {{project}}. Please provide a quote by {{date+7d}}.' },
  { id: 'tp.3', name: 'OOO — Latin reading retreat', body: 'I am at the Roma reading retreat through {{date+5d}}; for urgent matters, please reach Marcus at marcus@saltnlightllc.com.' },
];

const PLUGINS = [
  { id: 'pl.1', name: 'Jitsi Meet', desc: 'Video conferences as first-class calendar locations.', enabled: true, official: true, ver: '1.8.2' },
  { id: 'pl.2', name: 'PGP Inline (legacy)', desc: 'Decrypt and verify legacy PGP-inline emails alongside S/MIME.', enabled: false, official: true, ver: '0.3.0' },
  { id: 'pl.3', name: 'Tribunal stamp', desc: 'One-click cryptographic stamp for Tribunal-of-Records audit chains.', enabled: true, official: false, ver: '2.1.0', author: 'Salt & Light Engineering' },
  { id: 'pl.4', name: 'CIL crosslink', desc: 'Auto-detect Corpus Inscriptionum Latinarum citations and link them to the database.', enabled: false, official: false, ver: '0.9.1', author: 'L. Lapidary' },
];

Object.assign(window, {
  TAGS, ACCOUNTS, IDENTITIES, FOLDERS, CUSTOM_FOLDERS, SAVED_SEARCHES,
  THREADS, EVENTS, CONTACTS, FILES, FILE_FOLDERS, FILTERS_LIST, TEMPLATES, PLUGINS,
  NOW, avFor, initials,
});
