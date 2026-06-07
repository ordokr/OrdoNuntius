/* eslint-disable */

// =========================================================================
// MAIL MODULE
// =========================================================================

function MailModule({ ui, setUi, tweaks }) {
  const [folder, setFolder] = React.useState('f.inbox');
  const [splitTab, setSplitTab] = React.useState('focused'); // focused | other
  const [selected, setSelected] = React.useState('th.1');
  const [multi, setMulti] = React.useState(new Set());
  const [query, setQuery] = React.useState('');
  const [chips, setChips] = React.useState([]);

  const folderObj = [...FOLDERS, ...CUSTOM_FOLDERS].find(f => f.id === folder);

  const filtered = THREADS.filter(t => {
    if (folder !== 'f.starred' && folder !== 'f.inbox' && folder !== 'f.snoozed') return t.folder === folder;
    if (folder === 'f.starred') return t.starred;
    if (folder === 'f.inbox') {
      if (tweaks.splitInbox) {
        const focused = t.tags?.some(tg => ['t.work', 't.urgent', 't.finance', 't.review'].includes(tg));
        return t.folder === 'f.inbox' && (splitTab === 'focused' ? focused : !focused);
      }
      return t.folder === 'f.inbox';
    }
    if (folder === 'f.snoozed') return false;
    return false;
  }).filter(t => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (t.subject + ' ' + t.snippet + ' ' + t.participants.join(' ')).toLowerCase().includes(q);
  });

  const currentThread = THREADS.find(t => t.id === selected) || filtered[0];

  return (
    <div className="col" style={{ height: '100%', minHeight: 0 }}>
      <MailToolbar
        folder={folderObj}
        query={query} setQuery={setQuery}
        chips={chips} setChips={setChips}
        multi={multi} setMulti={setMulti}
        ui={ui} setUi={setUi}
        tweaks={tweaks}
      />
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <ThreadList
          threads={filtered}
          selected={selected} setSelected={setSelected}
          multi={multi} setMulti={setMulti}
          folder={folder}
          splitInbox={tweaks.splitInbox && folder === 'f.inbox'}
          splitTab={splitTab} setSplitTab={setSplitTab}
          tweaks={tweaks}
        />
        <div className="divider-v" />
        <div className="col flex-1" style={{ minWidth: 0, minHeight: 0 }}>
          {currentThread ? <ThreadView thread={currentThread} tweaks={tweaks}/> : <EmptyReader/>}
        </div>
      </div>
    </div>
  );
}

// -------------- Toolbar (top bar above lists) --------------

function MailToolbar({ folder, query, setQuery, chips, setChips, multi, ui, setUi, tweaks }) {
  const hasSel = multi.size > 0;
  const [filterOpen, setFilterOpen] = React.useState(false);

  return (
    <div className="col" style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
      <div className="row gap-2" style={{ padding: '10px 16px', minHeight: 52 }}>
        <div className="col flex-1" style={{ minWidth: 0 }}>
          <div className="row gap-3">
            <span className="serif" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em' }}>
              {folder?.name || 'Inbox'}
            </span>
            <span className="t-mute t-sm t-tab" style={{ marginTop: 4 }}>
              {folder?.unread > 0 && <span style={{ color: 'var(--wax)', fontWeight: 600 }}>{folder.unread} unread · </span>}
              {folder?.count} messages
            </span>
          </div>
        </div>

        <div className="row gap-2" style={{ position: 'relative' }}>
          <div className="row" style={{
            width: ui.searchWide ? 480 : 280,
            transition: 'width 200ms',
            background: 'var(--bg)', border: '1px solid var(--line)',
            borderRadius: 8, padding: '0 8px', height: 32,
          }}>
            <Icon name="search" size={14} style={{ color: 'var(--ink-3)', marginRight: 6 }}/>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setUi({ ...ui, searchWide: true })}
              onBlur={() => setUi({ ...ui, searchWide: false })}
              placeholder="Search mail — from:, has:, larger:, older:…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 13, color: 'var(--ink)', minWidth: 0,
              }}
            />
            <span className="kbd">/</span>
          </div>
          <IconButton icon="filter" hint="Search filters" onClick={() => setFilterOpen(v => !v)} active={filterOpen}/>
          {filterOpen && <SearchFilterPanel onClose={() => setFilterOpen(false)} onApply={(c) => { setChips([...chips, ...c]); setFilterOpen(false); }}/>}
        </div>

        <div className="divider-v" style={{ height: 18, margin: '0 4px' }}/>

        <IconButton icon="refresh" hint="Sync now (G then R)" />
        <IconButton icon="layout" hint="Layout" />
        <IconButton icon="cmd" hint="Command palette · ⌘K" onClick={() => window.__openCmd?.()}/>
      </div>

      {/* Search chips row */}
      {(chips.length > 0 || hasSel) && (
        <div className="row gap-2" style={{ padding: '6px 16px 10px', flexWrap: 'wrap' }}>
          {hasSel && (
            <div className="row gap-1">
              <span className="chip chip--on">{multi.size} selected</span>
              <button className="btn btn--ghost btn--sm"><Icon name="archive" size={13}/> Archive</button>
              <button className="btn btn--ghost btn--sm"><Icon name="trash" size={13}/> Delete</button>
              <button className="btn btn--ghost btn--sm"><Icon name="tag" size={13}/> Tag</button>
              <button className="btn btn--ghost btn--sm"><Icon name="snooze" size={13}/> Snooze</button>
              <button className="btn btn--ghost btn--sm"><Icon name="folder" size={13}/> Move</button>
              <span className="divider-v" style={{ height: 16, margin: '0 4px' }}/>
            </div>
          )}
          {chips.map((c, i) => (
            <span key={i} className="chip chip--on">
              <span style={{ fontWeight: 500 }}>{c.k}:</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{c.v}</span>
              <button onClick={() => setChips(chips.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer', display: 'inline-flex' }}><Icon name="x" size={10}/></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchFilterPanel({ onClose, onApply }) {
  const [from, setFrom] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [has, setHas] = React.useState({});
  const [size, setSize] = React.useState('');
  const apply = () => {
    const c = [];
    if (from) c.push({ k: 'from', v: from });
    if (subject) c.push({ k: 'subject', v: '"' + subject + '"' });
    if (has.attachment) c.push({ k: 'has', v: 'attachment' });
    if (has.smime) c.push({ k: 'has', v: 'smime' });
    if (has.imip) c.push({ k: 'has', v: 'imip' });
    if (size) c.push({ k: 'larger', v: size });
    onApply(c);
  };
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={onClose}/>
      <div className="card scale-in" style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 16,
        width: 380, padding: 16, zIndex: 60, boxShadow: 'var(--shadow-3)',
      }}>
        <div className="col gap-4">
          <div className="serif" style={{ fontSize: 16, fontWeight: 500 }}>Search filters</div>

          <Field label="From"><input className="input" value={from} onChange={e => setFrom(e.target.value)} placeholder="marcus@…"/></Field>
          <Field label="Subject contains"><input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="quarterly"/></Field>
          <Field label="Date range">
            <div className="row gap-2">
              <input className="input" placeholder="Any"/>
              <input className="input" placeholder="Any"/>
            </div>
          </Field>
          <Field label="Has">
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              {[
                ['attachment', 'Attachment'],
                ['smime', 'S/MIME signed'],
                ['imip', 'Calendar invite'],
                ['unsubscribe', 'List-Unsubscribe'],
              ].map(([k, l]) => (
                <button key={k} className={"chip " + (has[k] ? 'chip--on' : '')} onClick={() => setHas({ ...has, [k]: !has[k] })}>
                  {has[k] && <Icon name="check" size={11}/>}
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Larger than"><input className="input" value={size} onChange={e => setSize(e.target.value)} placeholder="5M"/></Field>

          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary" onClick={apply}>Apply</button>
          </div>
          <div className="t-mute t-sm">Cross-mailbox JMAP filter · saves to Saved searches</div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div className="col gap-2">
      <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</label>
      {children}
    </div>
  );
}

// -------------- Thread List --------------

function ThreadList({ threads, selected, setSelected, multi, setMulti, splitInbox, splitTab, setSplitTab, tweaks }) {
  const toggle = (id, e) => {
    e.stopPropagation();
    const next = new Set(multi);
    next.has(id) ? next.delete(id) : next.add(id);
    setMulti(next);
  };

  return (
    <div className="col" style={{ width: 400, flexShrink: 0, background: 'var(--bg-elev)', minHeight: 0 }}>
      {splitInbox && (
        <div className="row" style={{ borderBottom: '1px solid var(--line)', padding: '0 12px', height: 36, gap: 4 }}>
          {[
            ['focused', 'Imbox', 9],
            ['other', 'The Feed', 3],
          ].map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setSplitTab(id)}
              className="row gap-2"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '0 4px',
                fontSize: 12.5,
                fontWeight: 600,
                color: splitTab === id ? 'var(--ink)' : 'var(--ink-3)',
                borderBottom: '2px solid ' + (splitTab === id ? 'var(--wax)' : 'transparent'),
                height: 35, marginBottom: -1,
              }}
            >
              <span className="serif" style={{ fontWeight: 500, fontSize: 14, fontStyle: 'italic' }}>{label}</span>
              <span className="t-tab" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {threads.map((t, i) => (
          <ThreadRow
            key={t.id}
            thread={t}
            selected={selected === t.id}
            multi={multi.has(t.id)}
            onClick={() => setSelected(t.id)}
            onToggle={(e) => toggle(t.id, e)}
            tweaks={tweaks}
          />
        ))}
        {threads.length === 0 && (
          <div className="col" style={{ padding: 32, alignItems: 'center', gap: 8, color: 'var(--ink-3)' }}>
            <Icon name="inbox" size={36}/>
            <div className="t-sm">No conversations here</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ thread, selected, multi, onClick, onToggle, tweaks }) {
  const t = thread;
  const time = t.messages?.[0]?.date ? fmtTime(t.messages[0].date) : '';
  const pad = tweaks.density === 'compact' ? '8px 14px' : tweaks.density === 'comfortable' ? '16px 14px' : '12px 14px';

  return (
    <div
      onClick={onClick}
      className="row"
      style={{
        padding: pad,
        cursor: 'pointer',
        position: 'relative',
        background: selected ? 'var(--bg-active)' : multi ? 'var(--accent-tint)' : 'transparent',
        borderBottom: '1px solid var(--line)',
        gap: 12,
        alignItems: 'flex-start',
      }}
      onMouseEnter={e => { if (!selected && !multi) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!selected && !multi) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Unread marker */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: t.unread ? 'var(--wax)' : 'transparent',
      }}/>

      {/* Checkbox / avatar */}
      <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
        <Avatar name={t.participants[0]} size="md"/>
        <button
          onClick={onToggle}
          style={{
            position: 'absolute', inset: 0,
            border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: multi ? 1 : 0,
            transition: 'opacity 120ms',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = 1}
          onMouseLeave={e => { if (!multi) e.currentTarget.style.opacity = 0; }}
        >
          <span style={{
            width: 18, height: 18, borderRadius: 4,
            background: multi ? 'var(--accent)' : 'var(--bg-elev)',
            border: '1.5px solid ' + (multi ? 'var(--accent)' : 'var(--ink-3)'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {multi && <Icon name="check" size={11} style={{ color: 'white', strokeWidth: 3 }}/>}
          </span>
        </button>
      </div>

      <div className="col flex-1" style={{ gap: 2, minWidth: 0 }}>
        <div className="row gap-2" style={{ minWidth: 0 }}>
          <span style={{
            fontSize: 13.5, fontWeight: t.unread ? 600 : 500, color: 'var(--ink)',
            flex: '0 1 auto', minWidth: 0,
          }} className="truncate">
            {t.participants.length > 1 ? `${t.participants[0].split(' ')[0]}, ${t.participants[1].split(' ')[0]}${t.participants.length > 2 ? ' +' + (t.participants.length - 2) : ''}` : t.participants[0]}
          </span>
          {t.threadCount && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>· {t.threadCount}</span>}
          {t.smime === 'signed' && <Icon name="shieldCheck" size={11} style={{ color: 'var(--ok)' }}/>}
          {t.smime === 'encrypted' && <Icon name="lock" size={11} style={{ color: 'var(--accent)' }}/>}
          {t.imip && <Icon name="calendar" size={11} style={{ color: 'var(--t-violet)' }}/>}
          <span className="flex-1"/>
          {t.pinned && <Icon name="pin" size={11} style={{ color: 'var(--wax)' }}/>}
          {t.starred && <Icon name="star" size={12} style={{ color: 'var(--wax)', fill: 'var(--wax)' }} strokeWidth={1.5}/>}
          <span className="t-mute t-tab" style={{ fontSize: 11, color: t.unread ? 'var(--ink)' : 'var(--ink-3)', fontWeight: t.unread ? 600 : 400 }}>{time}</span>
        </div>

        <div className="row gap-2" style={{ minWidth: 0 }}>
          <span style={{
            fontSize: 13, fontWeight: t.unread ? 600 : 500, color: 'var(--ink)',
            flex: '1 1 auto', minWidth: 0,
          }} className="truncate">{t.subject}</span>
          {t.hasAttachment && <Icon name="paperclip" size={11} style={{ color: 'var(--ink-3)' }}/>}
          {t.important && <Icon name="alert" size={11} style={{ color: 'var(--danger)' }}/>}
        </div>

        {tweaks.density !== 'compact' && (
          <div className="t-mute truncate" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{t.snippet}</div>
        )}

        {t.tags?.length > 0 && tweaks.density !== 'compact' && (
          <div className="row gap-1" style={{ marginTop: 4, flexWrap: 'wrap' }}>
            {t.tags.map(tagId => <TagPill key={tagId} tagId={tagId}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyReader() {
  return (
    <div className="col" style={{ alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: 'var(--ink-3)' }}>
      <BrandMark size={48}/>
      <div className="serif-i" style={{ fontSize: 18 }}>No conversation selected</div>
      <div className="t-sm">Pick a thread from the list, or press <span className="kbd">⌘K</span> to search.</div>
    </div>
  );
}

// -------------- Thread (reading) view --------------

function ThreadView({ thread, tweaks }) {
  const [showQR, setShowQR] = React.useState(true);
  const [showRSVP, setShowRSVP] = React.useState(null);
  const msg = thread.messages[0];

  return (
    <div className="col" style={{ height: '100%', minHeight: 0, background: 'var(--bg-elev)' }}>
      <ThreadActionBar thread={thread}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px 24px' }}>
        {/* Subject + meta */}
        <div className="col gap-3" style={{ marginBottom: 20 }}>
          <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
            <h1 className="serif" style={{
              fontSize: 26, fontWeight: 400, margin: 0, letterSpacing: '-0.012em',
              lineHeight: 1.25, flex: 1,
            }}>{thread.subject}</h1>
            <div className="row gap-1">
              <IconButton icon={thread.starred ? 'star' : 'star'} hint="Star" size={32} iconSize={16} active={thread.starred}/>
            </div>
          </div>

          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {thread.tags?.map(t => <TagPill key={t} tagId={t}/>)}
            <button className="chip"><Icon name="plus" size={11}/> Tag</button>
            {thread.smime && <SecurityBadge kind={thread.smime}/>}
            {thread.messages.length > 1 && (
              <span className="tag" style={{ background: 'var(--bg-hover)' }}>
                <Icon name="users" size={11}/> {thread.messages.length} messages in thread
              </span>
            )}
          </div>
        </div>

        {/* Inline iMIP invite */}
        {msg.invite && <InviteCard invite={msg.invite} onRSVP={setShowRSVP} active={showRSVP}/>}

        {/* Message header */}
        <MessageHeader msg={msg} thread={thread}/>

        {/* Message body */}
        <div className="email-content" style={{ padding: 0, marginTop: 16, fontSize: 14.5, lineHeight: 1.65 }}>
          <FormattedBody body={msg.body}/>
        </div>

        {/* Attachments */}
        {msg.attachments?.length > 0 && <AttachmentRow files={msg.attachments}/>}

        {/* Security panel */}
        {msg.smime && <SmimeSecurityCard msg={msg}/>}

        {/* Earlier in this thread (mock) */}
        {thread.messages.length > 1 && <ThreadOlder count={thread.messages.length - 1}/>}

        {/* Quick reply */}
        {showQR && <QuickReply onExpand={() => window.__openCompose?.({ replyTo: thread })} onClose={() => setShowQR(false)}/>}
      </div>
    </div>
  );
}

function ThreadActionBar({ thread }) {
  return (
    <div className="row gap-1" style={{
      padding: '8px 16px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg-tint)',
    }}>
      <ToolButton icon="reply" label="Reply" hint="R" onClick={() => window.__openCompose?.({ replyTo: thread })}/>
      <ToolButton icon="replyAll" label="Reply all" hint="A"/>
      <ToolButton icon="forward" label="Forward" hint="F"/>
      <div className="divider-v" style={{ height: 16, margin: '0 6px' }}/>
      <IconButton icon="archive" hint="Archive · E"/>
      <IconButton icon="trash" hint="Delete · #"/>
      <IconButton icon="snooze" hint="Snooze · H"/>
      <IconButton icon="folder" hint="Move to · V"/>
      <IconButton icon="tag" hint="Tag · L"/>
      <IconButton icon="spam" hint="Report spam"/>
      <span className="flex-1"/>
      <IconButton icon="chevU" hint="Previous · K"/>
      <IconButton icon="chevD" hint="Next · J"/>
      <div className="divider-v" style={{ height: 16, margin: '0 6px' }}/>
      <IconButton icon="moreV" hint="More"/>
    </div>
  );
}

function MessageHeader({ msg, thread }) {
  const [showDetails, setShowDetails] = React.useState(false);
  return (
    <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
      <Avatar name={msg.from} size="lg"/>
      <div className="col flex-1" style={{ gap: 2, minWidth: 0 }}>
        <div className="row gap-2" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{msg.from}</span>
          <span className="t-mute" style={{ fontSize: 12.5 }}>&lt;{msg.fromEmail || (msg.from.toLowerCase().replace(/ /g, '.') + '@example.com')}&gt;</span>
          {msg.from === 'Marcus Volusianus' && <span className="tag" style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}><Icon name="user" size={10}/> Trusted</span>}
        </div>
        <div className="row gap-2" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          <span>to</span>
          <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>me</span>
          {msg.cc?.length > 0 && (<><span>·</span><span>cc</span><span style={{ color: 'var(--ink-2)' }}>{msg.cc[0].split(' <')[0]}</span></>)}
          <button onClick={() => setShowDetails(!showDetails)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12.5 }}>
            {showDetails ? 'Hide' : 'Show'} details
          </button>
        </div>
        {showDetails && (
          <div className="card" style={{ padding: 10, marginTop: 8, background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <div className="col gap-1">
              <div><span style={{ color: 'var(--ink-3)' }}>From:</span> {msg.from} &lt;{msg.fromEmail}&gt;</div>
              <div><span style={{ color: 'var(--ink-3)' }}>Reply-To:</span> {msg.fromEmail}</div>
              <div><span style={{ color: 'var(--ink-3)' }}>Date:</span> {fmtFullTime(msg.date)}</div>
              <div><span style={{ color: 'var(--ink-3)' }}>Message-ID:</span> &lt;{msg.id}.20260514@saltnlightllc.com&gt;</div>
              <div><span style={{ color: 'var(--ink-3)' }}>SPF:</span> <span style={{ color: 'var(--ok)' }}>pass</span> · <span style={{ color: 'var(--ink-3)' }}>DKIM:</span> <span style={{ color: 'var(--ok)' }}>pass</span> · <span style={{ color: 'var(--ink-3)' }}>DMARC:</span> <span style={{ color: 'var(--ok)' }}>pass</span></div>
            </div>
          </div>
        )}
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>{fmtFullTime(msg.date)}</span>
        <span className="t-mute" style={{ fontSize: 11 }}>4.2 KB · via JMAP</span>
      </div>
    </div>
  );
}

function FormattedBody({ body }) {
  // simple markdown-ish: ** for bold, • bullets, lines
  const parts = body.split(/\n\n+/);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('•')) {
          const items = p.split('\n').filter(l => l.startsWith('•'));
          return (
            <ul key={i} style={{ paddingLeft: 18, margin: '12px 0' }}>
              {items.map((l, j) => <li key={j} style={{ margin: '4px 0' }} dangerouslySetInnerHTML={{ __html: l.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }}/>)}
            </ul>
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} style={{ margin: '12px 0' }}/>;
      })}
    </>
  );
}

function AttachmentRow({ files }) {
  return (
    <div className="col gap-2" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
      <div className="row gap-2" style={{ color: 'var(--ink-3)', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        <Icon name="paperclip" size={12}/> {files.length} attachment{files.length > 1 ? 's' : ''}
      </div>
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        {files.map((f, i) => <AttachmentChip key={i} file={f}/>)}
      </div>
    </div>
  );
}

function AttachmentChip({ file }) {
  const colors = { pdf: ['#FEE2E2', '#B91C1C'], sheet: ['#DCFCE7', '#15803D'], image: ['#EDE9FE', '#7C3AED'], audio: ['#FEF3C7', '#B45309'], video: ['#FCE7F3', '#BE185D'], text: ['#F1F5F9', '#475569'] };
  const [bg, fg] = colors[file.kind] || colors.text;
  const ext = file.name.split('.').pop().toUpperCase();
  return (
    <div className="row gap-3 card" style={{
      padding: '8px 10px',
      minWidth: 220,
      cursor: 'pointer',
      transition: 'border-color 120ms',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
    >
      <div style={{
        width: 36, height: 44, borderRadius: 4, background: bg,
        color: fg, fontSize: 9, fontWeight: 700, letterSpacing: '0.03em',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '4px 0',
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, background: 'color-mix(in srgb, ' + fg + ' 30%, transparent)', clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}/>
        {ext}
      </div>
      <div className="col flex-1" style={{ minWidth: 0, gap: 1 }}>
        <span className="truncate" style={{ fontSize: 12.5, fontWeight: 500 }}>{file.name}</span>
        <span className="t-mute" style={{ fontSize: 11 }}>{file.size}</span>
      </div>
      <IconButton icon="download" hint="Download" iconSize={13} size={26}/>
    </div>
  );
}

function SmimeSecurityCard({ msg }) {
  if (!msg.smime) return null;
  return (
    <div className="card" style={{
      marginTop: 20, padding: 12,
      background: 'color-mix(in srgb, var(--ok) 5%, var(--bg-elev))',
      borderColor: 'color-mix(in srgb, var(--ok) 25%, var(--line))',
    }}>
      <div className="row gap-3">
        <div style={{
          width: 28, height: 28, borderRadius: 999,
          background: 'var(--ok-tint)', color: 'var(--ok)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="shieldCheck" size={16}/>
        </div>
        <div className="col flex-1" style={{ gap: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Signed and verified · S/MIME</div>
          <div className="t-mute" style={{ fontSize: 12 }}>
            Signed by <span style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{msg.smime.signer}</span> · Issuer: {msg.smime.issuer}
          </div>
        </div>
        <button className="btn btn--sm btn--outline">View certificate</button>
      </div>
    </div>
  );
}

function ThreadOlder({ count }) {
  return (
    <button className="row gap-2" style={{
      marginTop: 16,
      padding: '8px 12px',
      background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8,
      cursor: 'pointer', width: '100%', textAlign: 'left',
      color: 'var(--ink-2)', fontSize: 12.5,
    }}>
      <Icon name="chevD" size={13}/>
      <span>{count} earlier message{count > 1 ? 's' : ''} in this thread</span>
    </button>
  );
}

// -------------- Quick reply --------------

function QuickReply({ onExpand, onClose }) {
  const [text, setText] = React.useState('');
  return (
    <div className="card" style={{ marginTop: 24, padding: 14 }}>
      <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
        <Avatar name="Aurelia Tertius" size="sm"/>
        <div className="col flex-1" style={{ gap: 8 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write a quick reply… or press ⌘↵ to send"
            style={{
              width: '100%', border: 'none', resize: 'none',
              background: 'transparent', outline: 'none',
              fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6,
              minHeight: 56, color: 'var(--ink)',
            }}
          />
          <div className="row gap-2">
            <button className="btn btn--accent btn--sm">
              <Icon name="send" size={12}/> Send
              <span className="kbd" style={{ marginLeft: 4 }}>⌘↵</span>
            </button>
            <div className="row" style={{
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 6, padding: '0 6px', height: 24, gap: 4,
              fontSize: 11, color: 'var(--ink-2)',
            }}>
              <Icon name="clock" size={11}/> <span>Schedule for tomorrow 9:00</span>
            </div>
            <span className="flex-1"/>
            <IconButton icon="paperclip" hint="Attach" iconSize={13} size={26}/>
            <IconButton icon="sparkles" hint="Smart reply" iconSize={13} size={26}/>
            <IconButton icon="external" hint="Open in composer" iconSize={13} size={26} onClick={onExpand}/>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------- iMIP invite card --------------

function InviteCard({ invite, onRSVP, active }) {
  const [status, setStatus] = React.useState(null);
  return (
    <div className="card" style={{
      marginBottom: 18, padding: 16,
      background: 'var(--bg-tint)',
      borderLeft: '3px solid var(--t-violet)',
    }}>
      <div className="row gap-2" style={{ marginBottom: 12 }}>
        <Icon name="calendar" size={14} style={{ color: 'var(--t-violet)' }}/>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--t-violet)' }}>
          Calendar invitation · iMIP RFC 5545
        </span>
      </div>
      <div className="serif" style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{invite.title}</div>
      <div className="col gap-2" style={{ marginBottom: 14 }}>
        <div className="row gap-2 t-sm" style={{ color: 'var(--ink-2)' }}>
          <Icon name="clock" size={13} style={{ color: 'var(--ink-3)' }}/>
          <span>{invite.start} — {invite.end}</span>
        </div>
        <div className="row gap-2 t-sm" style={{ color: 'var(--ink-2)' }}>
          <Icon name="globe" size={13} style={{ color: 'var(--ink-3)' }}/>
          <span className="mono" style={{ fontSize: 12 }}>{invite.location}</span>
          <button className="chip" style={{ height: 18 }}><Icon name="external" size={10}/> Join</button>
        </div>
        <div className="row gap-2 t-sm" style={{ color: 'var(--ink-2)' }}>
          <Icon name="users" size={13} style={{ color: 'var(--ink-3)' }}/>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {invite.attendees.map((a, i) => (
              <span key={i} className="row gap-1" style={{ fontSize: 12.5 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 999,
                  background: a.status === 'accepted' ? 'var(--ok)'
                    : a.status === 'tentative' ? 'var(--warn)'
                    : a.status === 'organizer' ? 'var(--t-violet)'
                    : 'var(--ink-4)',
                }}/>
                {a.me ? <strong>You</strong> : a.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="row gap-2">
        {[
          ['accepted', 'Accept', 'check', 'var(--ok)', 'var(--ok-tint)'],
          ['tentative', 'Maybe', 'clock', 'var(--warn)', 'var(--warn-tint)'],
          ['declined', 'Decline', 'x', 'var(--danger)', 'var(--danger-tint)'],
        ].map(([id, label, icon, fg, bg]) => (
          <button
            key={id}
            onClick={() => setStatus(id)}
            className="btn btn--sm"
            style={{
              background: status === id ? bg : 'var(--bg-elev)',
              color: status === id ? fg : 'var(--ink-2)',
              border: '1px solid ' + (status === id ? 'color-mix(in srgb, ' + fg + ' 30%, transparent)' : 'var(--line)'),
              fontWeight: status === id ? 600 : 500,
            }}
          >
            <Icon name={icon} size={13}/> {label}
          </button>
        ))}
        <span className="flex-1"/>
        <button className="btn btn--ghost btn--sm"><Icon name="download" size={12}/> .ics</button>
        <span className="row gap-1 t-mute t-sm">
          <Icon name="shieldCheck" size={12} style={{ color: 'var(--ok)' }}/> Trusted organizer
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { MailModule });
