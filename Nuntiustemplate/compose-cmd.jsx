/* eslint-disable */

// =========================================================================
// COMPOSE
// =========================================================================

function ComposeModal({ open, onClose, draft }) {
  const [to, setTo] = React.useState(draft?.to || '');
  const [cc, setCc] = React.useState('');
  const [showCc, setShowCc] = React.useState(false);
  const [subject, setSubject] = React.useState(draft?.replyTo ? 'Re: ' + draft.replyTo.subject : '');
  const [body, setBody] = React.useState('');
  const [fromIdent, setFromIdent] = React.useState(IDENTITIES[0]);
  const [minimized, setMinimized] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [showSchedule, setShowSchedule] = React.useState(false);
  const [scheduled, setScheduled] = React.useState(null);
  const [toolbarRich, setToolbarRich] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTo(''); setCc(''); setSubject(''); setBody(''); setShowCc(false);
      setMinimized(false); setMaximized(false); setScheduled(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)',
        zIndex: 200, animation: 'fadeIn 180ms',
      }}/>
      <div
        className="card slide-up"
        style={{
          position: 'fixed',
          ...(maximized
            ? { inset: 24 }
            : minimized
              ? { right: 24, bottom: 0, width: 380, height: 44 }
              : { right: 24, bottom: 24, width: 720, height: 600 }),
          zIndex: 201,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          transition: 'all 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div className="row gap-2" style={{
          padding: '8px 12px', borderBottom: '1px solid var(--line)',
          background: 'var(--bg)', cursor: 'move',
        }}>
          <Icon name="pencil" size={14} style={{ color: 'var(--ink-3)' }}/>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{draft?.replyTo ? 'Reply' : 'New message'}</span>
          {scheduled && (
            <span className="tag" style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}>
              <Icon name="clock" size={10}/> {scheduled}
            </span>
          )}
          <span className="flex-1"/>
          <IconButton icon="minus" hint="Minimize" iconSize={13} size={26} onClick={() => setMinimized(!minimized)}/>
          <IconButton icon={maximized ? 'resize' : 'resize'} hint="Maximize" iconSize={13} size={26} onClick={() => setMaximized(!maximized)}/>
          <IconButton icon="x" hint="Discard" iconSize={13} size={26} onClick={onClose}/>
        </div>

        {!minimized && (
          <>
            <div className="col" style={{ borderBottom: '1px solid var(--line)' }}>
              <ComposeRow label="From">
                <button className="row gap-2" style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '4px 8px', borderRadius: 4, fontSize: 13,
                }}>
                  <Avatar name={fromIdent.from} size="xs"/>
                  <span>{fromIdent.from} &lt;{fromIdent.email}&gt;</span>
                  <Icon name="chevD" size={11} style={{ color: 'var(--ink-3)' }}/>
                </button>
              </ComposeRow>
              <ComposeRow label="To" action={!showCc && (
                <button onClick={() => setShowCc(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12, padding: '0 8px' }}>Cc · Bcc</button>
              )}>
                <input value={to} onChange={e => setTo(e.target.value)} placeholder="Recipients…" style={inputStyle}/>
              </ComposeRow>
              {showCc && (
                <>
                  <ComposeRow label="Cc"><input value={cc} onChange={e => setCc(e.target.value)} style={inputStyle}/></ComposeRow>
                  <ComposeRow label="Bcc"><input style={inputStyle}/></ComposeRow>
                </>
              )}
              <ComposeRow label="Subject">
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={{ ...inputStyle, fontWeight: 500 }}/>
              </ComposeRow>
            </div>

            <div className="row gap-1" style={{
              padding: '6px 10px', borderBottom: '1px solid var(--line)', background: 'var(--bg-tint)',
            }}>
              <IconButton icon="type" hint="Rich text" iconSize={13} size={26} active={toolbarRich} onClick={() => setToolbarRich(!toolbarRich)}/>
              <span className="kbd" style={{ marginLeft: 4, color: 'var(--ink-3)' }}>B</span>
              <span className="kbd" style={{ color: 'var(--ink-3)' }}>I</span>
              <span className="kbd" style={{ color: 'var(--ink-3)' }}>U</span>
              <div className="divider-v" style={{ height: 14, margin: '0 4px' }}/>
              <IconButton icon="paperclip" hint="Attach" iconSize={13} size={26}/>
              <IconButton icon="fileImg" hint="Inline image" iconSize={13} size={26}/>
              <IconButton icon="link" hint="Link" iconSize={13} size={26}/>
              <IconButton icon="template" hint="Insert template" iconSize={13} size={26}/>
              <div className="divider-v" style={{ height: 14, margin: '0 4px' }}/>
              <IconButton icon="lock" hint="Encrypt (S/MIME)" iconSize={13} size={26}/>
              <IconButton icon="shieldCheck" hint="Sign (S/MIME)" iconSize={13} size={26}/>
              <IconButton icon="sparkles" hint="Smart compose" iconSize={13} size={26}/>
              <span className="flex-1"/>
              <span className="t-mute t-sm">Plain · Identity: {fromIdent.from}</span>
            </div>

            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write your message…"
              style={{
                flex: 1, border: 'none', outline: 'none',
                resize: 'none', padding: '16px 18px',
                background: 'transparent',
                fontFamily: 'inherit', fontSize: 14, lineHeight: 1.65,
                color: 'var(--ink)',
              }}
            />

            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
              <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600, marginBottom: 6 }}>SIGNATURE</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>{fromIdent.signature}</div>
            </div>

            <div className="row gap-2" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--bg-elev)', position: 'relative' }}>
              <button className="btn btn--accent">
                <Icon name="send" size={13}/> Send
                <span className="kbd" style={{ marginLeft: 4, background: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)', color: 'white' }}>⌘↵</span>
              </button>
              <button className="btn btn--outline" onClick={() => setShowSchedule(v => !v)}>
                <Icon name="clock" size={13}/> Send later
                <Icon name="chevD" size={10} style={{ marginLeft: 2 }}/>
              </button>
              {showSchedule && (
                <Popover open onClose={() => setShowSchedule(false)} anchor="bl" style={{ left: 90, bottom: 'calc(100% + 4px)', top: 'auto', minWidth: 240 }}>
                  {[
                    ['In 1 hour', '11:42'],
                    ['Tonight, 18:00', 'Today'],
                    ['Tomorrow 09:00', 'Fri'],
                    ['Monday 09:00', '18 May'],
                    ['Custom…', null],
                  ].map(([l, t]) => (
                    <MenuItem key={l} icon="clock" label={l} hint={t} onClick={() => { setScheduled(l); setShowSchedule(false); }}/>
                  ))}
                </Popover>
              )}
              <span className="flex-1"/>
              <span className="t-mute t-sm row gap-2">
                <Icon name="check" size={12} style={{ color: 'var(--ok)' }}/>
                Draft auto-saved · 4 sec
              </span>
              <IconButton icon="trash" hint="Discard" iconSize={13} size={28}/>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const inputStyle = {
  flex: 1, border: 'none', outline: 'none',
  background: 'transparent', fontFamily: 'inherit',
  fontSize: 13, color: 'var(--ink)', padding: '4px 0',
};

function ComposeRow({ label, children, action }) {
  return (
    <div className="row" style={{ padding: '0 16px', borderBottom: '1px solid var(--line)', minHeight: 36 }}>
      <span style={{ width: 60, fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{label}</span>
      <div className="row flex-1" style={{ alignItems: 'center', minHeight: 36 }}>{children}</div>
      {action}
    </div>
  );
}

// =========================================================================
// COMMAND PALETTE
// =========================================================================

function CommandPalette({ open, onClose, goto, openCompose }) {
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);

  React.useEffect(() => { if (open) { setQ(''); setActive(0); } }, [open]);

  const commands = [
    { id: 'new', label: 'Compose new message', icon: 'pencil', kbd: 'C', section: 'Actions', run: () => { openCompose(); onClose(); } },
    { id: 'reply', label: 'Reply to current thread', icon: 'reply', kbd: 'R', section: 'Actions' },
    { id: 'snooze', label: 'Snooze conversation', icon: 'snooze', kbd: 'H', section: 'Actions' },
    { id: 'archive', label: 'Archive', icon: 'archive', kbd: 'E', section: 'Actions' },
    { id: 'undo', label: 'Undo last action', icon: 'history', kbd: '⌘Z', section: 'Actions' },

    { id: 'inbox', label: 'Go to Inbox', icon: 'inbox', kbd: 'G I', section: 'Go to', run: () => { goto('mail'); onClose(); } },
    { id: 'starred', label: 'Go to Starred', icon: 'star', kbd: 'G *', section: 'Go to' },
    { id: 'sent', label: 'Go to Sent', icon: 'send', kbd: 'G T', section: 'Go to' },
    { id: 'cal', label: 'Open Calendar', icon: 'calendar', kbd: 'G C', section: 'Go to', run: () => { goto('calendar'); onClose(); } },
    { id: 'con', label: 'Open Contacts', icon: 'contacts', kbd: 'G P', section: 'Go to', run: () => { goto('contacts'); onClose(); } },
    { id: 'files', label: 'Open Files', icon: 'files', kbd: 'G F', section: 'Go to', run: () => { goto('files'); onClose(); } },
    { id: 'flt', label: 'Open Filters & Rules', icon: 'filter', kbd: 'G R', section: 'Go to', run: () => { goto('filters'); onClose(); } },
    { id: 'set', label: 'Open Settings', icon: 'settings', kbd: 'G S', section: 'Go to', run: () => { goto('settings'); onClose(); } },

    { id: 'tag-urg', label: 'Tag: Urgent', icon: 'tag', section: 'Tags' },
    { id: 'tag-rev', label: 'Tag: Review', icon: 'tag', section: 'Tags' },
    { id: 'tag-fin', label: 'Tag: Finance', icon: 'tag', section: 'Tags' },

    { id: 'mv-inv', label: 'Move to: Invoices', icon: 'folder', section: 'Move' },
    { id: 'mv-lab', label: 'Move to: Lab notes', icon: 'folder', section: 'Move' },
    { id: 'mv-tra', label: 'Move to: Travel', icon: 'folder', section: 'Move' },

    { id: 'sc-rev', label: 'Search: Signed (S/MIME)', icon: 'search', section: 'Saved searches' },
    { id: 'sc-larg', label: 'Search: Over 5 MB', icon: 'search', section: 'Saved searches' },

    { id: 'ai-sum', label: 'Summarize thread', icon: 'sparkles', section: 'Smart' },
    { id: 'ai-tone', label: 'Rewrite reply: shorter, formal', icon: 'sparkles', section: 'Smart' },
  ];

  const filtered = q
    ? commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()))
    : commands;

  const sections = {};
  filtered.forEach(c => {
    if (!sections[c.section]) sections[c.section] = [];
    sections[c.section].push(c);
  });

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(2px)',
        zIndex: 250, animation: 'fadeIn 120ms',
      }}/>
      <div
        className="card scale-in"
        style={{
          position: 'fixed', left: '50%', top: '12vh',
          transform: 'translateX(-50%)',
          width: 640, maxWidth: 'calc(100vw - 32px)',
          zIndex: 251,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: 560,
        }}
      >
        <div className="row gap-3" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <Icon name="search" size={16} style={{ color: 'var(--ink-3)' }}/>
          <input
            autoFocus
            value={q}
            onChange={e => { setQ(e.target.value); setActive(0); }}
            placeholder="Type a command, or search…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', fontFamily: 'var(--font-display)',
              fontSize: 19, color: 'var(--ink)', letterSpacing: '-0.005em',
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {Object.entries(sections).map(([sec, items]) => (
            <div key={sec} style={{ marginBottom: 8 }}>
              <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600, padding: '6px 10px' }}>{sec}</div>
              {items.map((c) => {
                const i = filtered.indexOf(c);
                const isActive = i === active;
                return (
                  <button
                    key={c.id}
                    onClick={() => { c.run?.(); }}
                    onMouseEnter={() => setActive(i)}
                    className="row gap-3"
                    style={{
                      width: '100%', padding: '8px 10px',
                      background: isActive ? 'var(--bg-active)' : 'transparent',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      borderRadius: 6,
                    }}
                  >
                    <Icon name={c.icon} size={14} style={{ color: 'var(--ink-3)' }}/>
                    <span className="flex-1" style={{ fontSize: 13 }}>{c.label}</span>
                    {c.kbd && <span className="kbd">{c.kbd}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col" style={{ padding: 32, alignItems: 'center', gap: 8, color: 'var(--ink-3)' }}>
              <Icon name="search" size={20}/>
              <span className="t-sm">No commands match "{q}"</span>
            </div>
          )}
        </div>
        <div className="row gap-3 t-mute t-sm" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> run</span>
          <span className="flex-1"/>
          <span>Powered by <span className="serif-i" style={{ color: 'var(--ink-2)' }}>nuntius commands</span></span>
        </div>
      </div>
    </>
  );
}

// =========================================================================
// KEYBOARD SHORTCUTS MODAL
// =========================================================================

function ShortcutsModal({ open, onClose }) {
  if (!open) return null;
  const groups = [
    ['Global', [['Search', '/'], ['Command palette', '⌘K'], ['Compose new', 'C'], ['Show shortcuts', '?']]],
    ['Navigation', [['Next', 'J'], ['Previous', 'K'], ['Go to inbox', 'G I'], ['Go to sent', 'G T'], ['Go to calendar', 'G C']]],
    ['Mail', [['Reply', 'R'], ['Reply all', 'A'], ['Forward', 'F'], ['Archive', 'E'], ['Snooze', 'H'], ['Star', 'S'], ['Tag', 'L'], ['Move to', 'V']]],
    ['Composer', [['Send', '⌘↵'], ['Send later', '⌘⇧↵'], ['Discard', '⌘⇧D'], ['Save draft', '⌘S']]],
  ];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 250 }}/>
      <div className="card scale-in" style={{
        position: 'fixed', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 640, maxWidth: 'calc(100vw - 32px)',
        zIndex: 251, boxShadow: 'var(--shadow-pop)',
        padding: 24,
      }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <h2 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Keyboard shortcuts</h2>
          <span className="flex-1"/>
          <IconButton icon="x" onClick={onClose} hint="Close"/>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {groups.map(([g, items]) => (
            <div key={g} className="col gap-2">
              <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>{g}</div>
              {items.map(([l, k]) => (
                <div key={l} className="row gap-2" style={{ fontSize: 12.5 }}>
                  <span className="flex-1">{l}</span>
                  {k.split(' ').map((x, i) => <span key={i} className="kbd">{x}</span>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// =========================================================================
// UNDO-SEND BANNER
// =========================================================================

function UndoSendBanner({ message, onUndo, onDismiss, secondsLeft }) {
  return (
    <div className="row gap-3 slide-up" style={{
      position: 'fixed', left: 24, bottom: 24, zIndex: 220,
      padding: '12px 14px',
      background: 'var(--ink)', color: 'var(--bg-elev)',
      borderRadius: 10, boxShadow: 'var(--shadow-3)',
      minWidth: 360,
    }}>
      <Icon name="send" size={14}/>
      <span style={{ flex: 1, fontSize: 13 }}>{message}</span>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: 2,
        background: 'var(--wax)', width: ((secondsLeft / 8) * 100) + '%',
        transition: 'width 1s linear', borderBottomLeftRadius: 10,
      }}/>
      <button onClick={onUndo} className="btn btn--sm" style={{
        background: 'var(--wax)', color: 'white', fontWeight: 600,
      }}>
        Undo · {secondsLeft}s
      </button>
      <IconButton icon="x" iconSize={12} size={24} onClick={onDismiss}/>
    </div>
  );
}

Object.assign(window, { ComposeModal, CommandPalette, ShortcutsModal, UndoSendBanner });
