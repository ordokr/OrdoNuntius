/* eslint-disable */

// =========================================================================
// MAIN APP
// =========================================================================

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "indigo",
  "density": "regular",
  "splitInbox": true,
  "conversation": true,
  "showSnoozeBanner": true,
  "showUndoSend": true
}/*EDITMODE-END*/;

const ACCENTS = {
  indigo:  { '--accent': '#4F46E5', '--accent-2': '#6366F1', '--accent-tint': '#EEF0FE', '--accent-ring': '#C7D2FE', '--accent-ink': '#312E81', '--wax': '#B8612A', '--wax-tint': '#F8E8D6' },
  ember:   { '--accent': '#B8612A', '--accent-2': '#D97D45', '--accent-tint': '#FBEEDF', '--accent-ring': '#F0CFA8', '--accent-ink': '#7A3D14', '--wax': '#B8612A', '--wax-tint': '#F8E8D6' },
  ink:     { '--accent': '#0F172A', '--accent-2': '#1E293B', '--accent-tint': '#E2E8F0', '--accent-ring': '#CBD5E1', '--accent-ink': '#020617', '--wax': '#B45309', '--wax-tint': '#FEF3C7' },
  sage:    { '--accent': '#0D7B5A', '--accent-2': '#15A77F', '--accent-tint': '#DCFAEC', '--accent-ring': '#A7E3CB', '--accent-ink': '#054A36', '--wax': '#B45309', '--wax-tint': '#FEF3C7' },
  garnet:  { '--accent': '#9F1239', '--accent-2': '#BE123C', '--accent-tint': '#FFE4E6', '--accent-ring': '#FDA4AF', '--accent-ink': '#600720', '--wax': '#B45309', '--wax-tint': '#FEF3C7' },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = React.useState('mail'); // mail | calendar | contacts | files | filters | templates | settings
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeDraft, setComposeDraft] = React.useState(null);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [undoSend, setUndoSend] = React.useState(null);
  const [ui, setUi] = React.useState({ searchWide: false });

  // Apply theme + accent
  React.useEffect(() => {
    document.documentElement.dataset.theme = t.theme === 'dark' ? 'dark' : t.theme === 'sepia' ? 'sepia' : '';
    document.documentElement.dataset.density = t.density;

    const ac = ACCENTS[t.accent] || ACCENTS.indigo;
    for (const [k, v] of Object.entries(ac)) {
      document.documentElement.style.setProperty(k, v);
    }
  }, [t.theme, t.accent, t.density]);

  // Wire compose + cmd palette globally
  React.useEffect(() => {
    window.__openCompose = (draft) => { setComposeDraft(draft); setComposeOpen(true); };
    window.__openCmd = () => setCmdOpen(true);
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') e.target.blur();
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
      else if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setShortcutsOpen(true); }
      else if (e.key === 'c' && !e.metaKey) { e.preventDefault(); setComposeDraft(null); setComposeOpen(true); }
      else if (e.key === '/') { e.preventDefault(); document.querySelector('input[placeholder*="Search mail"]')?.focus(); }
      else if (e.key === 'Escape') { setCmdOpen(false); setShortcutsOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-tick undo-send banner
  React.useEffect(() => {
    if (!undoSend) return;
    if (undoSend.secondsLeft <= 0) { setUndoSend(null); return; }
    const t = setTimeout(() => setUndoSend(u => u ? { ...u, secondsLeft: u.secondsLeft - 1 } : null), 1000);
    return () => clearTimeout(t);
  }, [undoSend]);

  // Sync conversation flag to global (mail uses it)
  const tweaks = t;

  return (
    <div className="row" style={{ height: '100vh', width: '100vw', overflow: 'hidden', alignItems: 'stretch' }}>
      <AppRail view={view} setView={setView} onCompose={() => { setComposeDraft(null); setComposeOpen(true); }}/>
      {view === 'mail' && <MailSidebar />}
      <div className="col flex-1" style={{ minWidth: 0, minHeight: 0, height: '100%' }}>
        {view === 'mail' && <MailModule ui={ui} setUi={setUi} tweaks={tweaks}/>}
        {view === 'calendar' && <CalendarModule/>}
        {view === 'contacts' && <ContactsModule/>}
        {view === 'files' && <FilesModule/>}
        {view === 'filters' && <FiltersModule/>}
        {view === 'templates' && <TemplatesModule/>}
        {view === 'settings' && <SettingsModule/>}
      </div>

      <ComposeModal open={composeOpen} draft={composeDraft} onClose={() => {
        setComposeOpen(false);
        // simulate send → trigger undo banner
        if (t.showUndoSend && Math.random() > 0.4) {
          setUndoSend({ message: 'Message sent to Marcus Volusianus', secondsLeft: 8 });
        }
      }}/>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} goto={setView} openCompose={() => { setComposeDraft(null); setComposeOpen(true); }}/>
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)}/>

      {undoSend && (
        <UndoSendBanner
          message={undoSend.message}
          secondsLeft={undoSend.secondsLeft}
          onUndo={() => setUndoSend(null)}
          onDismiss={() => setUndoSend(null)}
        />
      )}

      <NuntiusTweaks t={t} setTweak={setTweak}/>
    </div>
  );
}

// -------------- App rail (apps switcher) --------------

function AppRail({ view, setView, onCompose }) {
  const [accountOpen, setAccountOpen] = React.useState(false);
  return (
    <div className="col" style={{
      width: 56, background: 'var(--bg-rail)', borderRight: '1px solid var(--line)',
      padding: '12px 0', alignItems: 'center', gap: 4, flexShrink: 0, height: '100%',
    }}>
      <div style={{ marginBottom: 8 }}>
        <BrandMark size={28}/>
      </div>

      <RailButton icon="pencil" label="Compose · C" onClick={onCompose} primary/>

      <div style={{ height: 8 }}/>

      {[
        ['mail', 'inbox', 'Mail · G I'],
        ['calendar', 'calendar', 'Calendar · G C'],
        ['contacts', 'contacts', 'Contacts · G P'],
        ['files', 'files', 'Files · G F'],
        ['filters', 'filter', 'Filters · G R'],
        ['templates', 'template', 'Templates · G L'],
      ].map(([id, icon, hint]) => (
        <RailButton
          key={id}
          icon={icon}
          label={hint}
          active={view === id}
          onClick={() => setView(id)}
          badge={id === 'mail' ? 4 : id === 'filters' ? null : null}
        />
      ))}

      <span className="flex-1"/>

      <RailButton icon="settings" label="Settings · G S" active={view === 'settings'} onClick={() => setView('settings')}/>

      <div style={{ position: 'relative', marginTop: 6 }}>
        <button
          onClick={() => setAccountOpen(!accountOpen)}
          style={{
            width: 36, height: 36, borderRadius: 999,
            border: '2px solid var(--bg-rail)',
            background: 'var(--accent)', color: 'white',
            cursor: 'pointer', position: 'relative',
            fontWeight: 600, fontSize: 11,
          }}
        >
          AT
          <span style={{
            position: 'absolute', bottom: -1, right: -1,
            width: 11, height: 11, borderRadius: 999,
            background: 'var(--ok)', border: '2px solid var(--bg-rail)',
          }}/>
        </button>
        {accountOpen && <AccountSwitcher onClose={() => setAccountOpen(false)}/>}
      </div>
    </div>
  );
}

function RailButton({ icon, label, active, primary, onClick, badge }) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        title={label}
        style={{
          width: 40, height: 40, borderRadius: 8,
          border: 'none',
          background: primary ? 'var(--ink)' : active ? 'var(--bg-active)' : 'transparent',
          color: primary ? 'var(--bg-elev)' : active ? 'var(--ink)' : 'var(--ink-3)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 100ms, color 100ms',
          position: 'relative',
        }}
        onMouseEnter={e => { if (!active && !primary) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--ink)'; } }}
        onMouseLeave={e => { if (!active && !primary) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; } }}
      >
        <Icon name={icon} size={18}/>
        {active && !primary && (
          <span style={{
            position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)',
            width: 3, height: 18, background: 'var(--wax)', borderRadius: '0 2px 2px 0',
          }}/>
        )}
        {badge && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 14, height: 14, borderRadius: 999,
            background: 'var(--wax)', color: 'white',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
            border: '2px solid var(--bg-rail)',
          }}>{badge}</span>
        )}
      </button>
    </div>
  );
}

function AccountSwitcher({ onClose }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={onClose}/>
      <div className="card scale-in" style={{
        position: 'absolute', bottom: 0, left: 'calc(100% + 8px)',
        width: 280, padding: 6, zIndex: 100, boxShadow: 'var(--shadow-3)',
      }}>
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600, padding: '8px 10px 4px' }}>
          Accounts · {ACCOUNTS.length}
        </div>
        {ACCOUNTS.map(a => (
          <MenuItem key={a.id}
            label={a.name}
            hint={a.email}
            checked={a.primary}
          />
        ))}
        <MenuDivider/>
        <MenuItem icon="plus" label="Add account"/>
        <MenuItem icon="settings" label="Manage identities"/>
        <MenuItem icon="x" label="Sign out" danger/>
      </div>
    </>
  );
}

// -------------- Mail sidebar (folders + tags + saved searches) --------------

function MailSidebar() {
  const [folder, setFolder] = React.useState('f.inbox');
  const [open, setOpen] = React.useState({ folders: true, tags: true, saved: true, custom: true });

  return (
    <div className="col" style={{
      width: 240, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--line)',
      overflowY: 'auto', flexShrink: 0, height: '100%', minHeight: 0,
    }}>
      <div className="row gap-3" style={{ padding: '14px 16px 8px' }}>
        <div className="col" style={{ gap: 1 }}>
          <span className="serif" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em' }}>
            <span style={{ fontStyle: 'italic' }}>Ordo</span>Nuntius
          </span>
          <span className="t-mute t-sm" style={{ fontSize: 10.5 }}>aurelia@saltnlightllc.com</span>
        </div>
        <span className="flex-1"/>
        <span title="JMAP push live" style={{
          width: 7, height: 7, borderRadius: 999,
          background: 'var(--ok)', flexShrink: 0,
          animation: 'pulseRing 2s infinite',
        }}/>
      </div>

      <div style={{ padding: '6px 12px 12px' }}>
        <button className="row gap-2" style={{
          width: '100%', padding: '0 12px', height: 34,
          background: 'var(--ink)', color: 'var(--bg-elev)',
          border: 'none', borderRadius: 8, cursor: 'pointer',
          fontWeight: 500, fontSize: 13,
        }} onClick={() => window.__openCompose?.()}>
          <Icon name="pencil" size={14}/>
          <span>Compose</span>
          <span className="flex-1"/>
          <span className="kbd" style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--bg-elev)', borderColor: 'rgba(255,255,255,0.25)' }}>C</span>
        </button>
      </div>

      <Section title="FOLDERS" open={open.folders} onToggle={() => setOpen({ ...open, folders: !open.folders })}>
        {FOLDERS.map(f => (
          <NavRow key={f.id} icon={f.icon} label={f.name}
            count={f.unread === 0 ? f.count : null}
            unreadCount={f.unread > 0 ? f.unread : null}
            active={folder === f.id} onClick={() => setFolder(f.id)}/>
        ))}
      </Section>

      <Section title="CUSTOM" open={open.custom} action="plus" onToggle={() => setOpen({ ...open, custom: !open.custom })}>
        {CUSTOM_FOLDERS.map(f => (
          <NavRow key={f.id} icon={f.icon} label={f.name}
            count={f.unread === 0 ? f.count : null}
            unreadCount={f.unread > 0 ? f.unread : null}
            active={folder === f.id} onClick={() => setFolder(f.id)}/>
        ))}
      </Section>

      <Section title="TAGS" open={open.tags} action="plus" onToggle={() => setOpen({ ...open, tags: !open.tags })}>
        {TAGS.map(t => (
          <button key={t.id} className="row gap-2" style={{
            width: 'calc(100% - 16px)', margin: '1px 8px', height: 28, padding: '0 12px',
            background: 'transparent', border: 'none', borderRadius: 6,
            cursor: 'pointer', textAlign: 'left', fontSize: 13, color: 'var(--ink-2)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }}/>
            <span className="flex-1 truncate">{t.name}</span>
          </button>
        ))}
      </Section>

      <Section title="SAVED SEARCHES" open={open.saved} action="plus" onToggle={() => setOpen({ ...open, saved: !open.saved })}>
        {SAVED_SEARCHES.map(s => (
          <NavRow key={s.id} icon={s.icon} label={s.name}/>
        ))}
      </Section>

      <div className="flex-1"/>

      <div className="col gap-1" style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
        <div className="row gap-2" style={{ padding: '4px 4px' }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--ok)', animation: 'pulseRing 2s infinite' }}/>
          <span className="t-mute t-sm">Synced just now · JMAP push</span>
        </div>
        <div className="t-mute t-sm" style={{ padding: '0 4px', fontSize: 10.5 }}>
          mail.saltnlightllc.com — v1.42.0
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, open, onToggle, action }) {
  return (
    <div className="col" style={{ marginBottom: 4 }}>
      <div className="row gap-2" style={{
        padding: '10px 12px 4px',
        color: 'var(--ink-3)', cursor: 'pointer',
      }} onClick={onToggle}>
        <Icon name={open ? 'chevD' : 'chevR'} size={11} style={{ color: 'var(--ink-4)' }}/>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', flex: 1 }}>{title}</span>
        {action && (
          <button onClick={e => e.stopPropagation()} className="btn btn--ghost btn--icon"
            style={{ width: 18, height: 18, color: 'var(--ink-4)' }}>
            <Icon name={action} size={11}/>
          </button>
        )}
      </div>
      {open && <div className="col">{children}</div>}
    </div>
  );
}

// -------------- Tweaks --------------

function NuntiusTweaks({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Appearance"/>
      <TweakRadio
        label="Theme" value={t.theme} options={['light', 'sepia', 'dark']}
        onChange={v => setTweak('theme', v)}
      />
      <TweakColor
        label="Accent"
        value={t.accent === 'indigo' ? '#4F46E5'
            : t.accent === 'ember' ? '#B8612A'
            : t.accent === 'ink' ? '#0F172A'
            : t.accent === 'sage' ? '#0D7B5A'
            : '#9F1239'}
        options={['#4F46E5', '#B8612A', '#0F172A', '#0D7B5A', '#9F1239']}
        onChange={v => {
          const map = { '#4F46E5': 'indigo', '#B8612A': 'ember', '#0F172A': 'ink', '#0D7B5A': 'sage', '#9F1239': 'garnet' };
          setTweak('accent', map[v] || 'indigo');
        }}
      />
      <TweakRadio
        label="Density" value={t.density} options={['compact', 'regular', 'comfortable']}
        onChange={v => setTweak('density', v)}
      />
      <TweakSection label="Behaviour"/>
      <TweakToggle label="Split Imbox / Feed" value={t.splitInbox} onChange={v => setTweak('splitInbox', v)}/>
      <TweakToggle label="Conversation view" value={t.conversation} onChange={v => setTweak('conversation', v)}/>
      <TweakToggle label="Undo send banner" value={t.showUndoSend} onChange={v => setTweak('showUndoSend', v)}/>
    </TweaksPanel>
  );
}

Object.assign(window, { App });
