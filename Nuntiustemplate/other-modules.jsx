/* eslint-disable */

// =========================================================================
// CONTACTS
// =========================================================================

function ContactsModule() {
  const [book, setBook] = React.useState('all');
  const [sel, setSel] = React.useState(CONTACTS[0]);

  const filtered = CONTACTS.filter(c => book === 'all' || c.book === book);

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row gap-3" style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>Contacts</h1>
        <span className="t-mute t-sm" style={{ marginTop: 4 }}>JMAP · RFC 9553</span>
        <span className="flex-1"/>
        <button className="btn btn--outline"><Icon name="upload" size={13}/> Import vCard</button>
        <button className="btn btn--accent"><Icon name="plus" size={13}/> New contact</button>
      </div>

      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div className="col" style={{ width: 220, padding: 12, gap: 2, borderRight: '1px solid var(--line)', background: 'var(--bg-sidebar)' }}>
          <NavRow icon="users" label="All contacts" count={CONTACTS.length} active={book === 'all'} onClick={() => setBook('all')}/>
          <NavRow icon="star" label="Favorites" count={CONTACTS.filter(c => c.favorite).length}/>
          <NavRow icon="shieldCheck" label="Trusted senders" count={CONTACTS.filter(c => c.trusted).length}/>
          <SectionLabel action="plus">Address books</SectionLabel>
          {['Salt & Light', 'OrdoEpistola', 'External'].map(b => (
            <NavRow key={b} icon="folder" label={b} count={CONTACTS.filter(c => c.book === b).length} active={book === b} onClick={() => setBook(b)}/>
          ))}
          <SectionLabel action="plus">Groups</SectionLabel>
          <NavRow icon="hash" label="Tribunal panel" count={5}/>
          <NavRow icon="hash" label="OrdoEpistola maintainers" count={4}/>
          <NavRow icon="hash" label="Reading group" count={11}/>
        </div>

        <div className="col" style={{ width: 320, background: 'var(--bg-elev)', borderRight: '1px solid var(--line)', overflowY: 'auto' }}>
          <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 8, padding: '0 8px', height: 30, gap: 6, width: '100%',
            }}>
              <Icon name="search" size={13} style={{ color: 'var(--ink-3)' }}/>
              <input placeholder="Search contacts…" style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 13, color: 'var(--ink)',
              }}/>
            </div>
          </div>
          {filtered.map(c => (
            <button key={c.id} onClick={() => setSel(c)} className="row gap-3" style={{
              width: '100%', padding: '10px 14px',
              background: sel?.id === c.id ? 'var(--bg-active)' : 'transparent',
              border: 'none', borderBottom: '1px solid var(--line)',
              cursor: 'pointer', textAlign: 'left',
            }}>
              <Avatar name={c.name} size="md"/>
              <div className="col flex-1" style={{ minWidth: 0, gap: 1 }}>
                <div className="row gap-1">
                  <span style={{ fontSize: 13, fontWeight: 500 }} className="truncate">{c.name}</span>
                  {c.favorite && <Icon name="star" size={10} style={{ color: 'var(--wax)', fill: 'var(--wax)' }}/>}
                  {c.trusted && <Icon name="shieldCheck" size={10} style={{ color: 'var(--ok)' }}/>}
                </div>
                <span className="truncate" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{c.email}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="col flex-1" style={{ background: 'var(--bg)', overflowY: 'auto', padding: 32 }}>
          {sel && <ContactDetail c={sel}/>}
        </div>
      </div>
    </div>
  );
}

function ContactDetail({ c }) {
  return (
    <div className="col gap-5" style={{ maxWidth: 600 }}>
      <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
        <Avatar name={c.name} size="lg" color={avFor(c.name)}/>
        <div className="col flex-1" style={{ gap: 2 }}>
          <h1 className="serif" style={{ fontSize: 26, fontWeight: 500, margin: 0, letterSpacing: '-0.01em' }}>{c.name}</h1>
          <div className="t-mute t-md">{c.role}{c.org ? ' · ' + c.org : ''}</div>
          <div className="row gap-2" style={{ marginTop: 10 }}>
            <button className="btn btn--accent btn--sm" onClick={() => window.__openCompose?.({ to: c.email })}><Icon name="pencil" size={12}/> Email</button>
            <button className="btn btn--outline btn--sm"><Icon name="calendar" size={12}/> Schedule</button>
            <button className="btn btn--outline btn--sm"><Icon name="star" size={12}/></button>
            <button className="btn btn--outline btn--sm"><Icon name="moreV" size={12}/></button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="col gap-3">
          <DetailRow label="Email" value={c.email} icon="at"/>
          {c.phone && <DetailRow label="Phone" value={c.phone} icon="user"/>}
          {c.org && <DetailRow label="Organization" value={c.org} icon="briefcase"/>}
          <DetailRow label="Address book" value={c.book} icon="folder"/>
          {c.trusted && <DetailRow label="Trust" value="Trusted sender · external content allowed" icon="shieldCheck" color="var(--ok)"/>}
        </div>
      </div>

      <div className="col gap-3">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Recent activity</div>
          <button className="btn btn--ghost btn--sm">View all</button>
        </div>
        <div className="card">
          {[
            ['Q2 procurement — three quotes', '7 min'],
            ['Re: Sprint 47 — postmortem', '1 d'],
            ['Vendor-Quotes-2026Q2.pdf', '7 min'],
          ].map(([t, time], i) => (
            <div key={i} className="row gap-3" style={{ padding: '10px 14px', borderBottom: i < 2 ? '1px solid var(--line)' : 'none' }}>
              <Icon name={i === 2 ? 'paperclip' : 'inbox'} size={13} style={{ color: 'var(--ink-3)' }}/>
              <span className="flex-1 truncate" style={{ fontSize: 13 }}>{t}</span>
              <span className="t-mute t-sm">{time}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="col gap-3">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>vCard (RFC 6350)</div>
        <div className="card mono" style={{ padding: 12, fontSize: 11.5, color: 'var(--ink-2)', whiteSpace: 'pre' }}>{`BEGIN:VCARD
VERSION:4.0
FN:${c.name}
EMAIL;TYPE=work:${c.email}
${c.phone ? 'TEL;TYPE=work,voice:' + c.phone + '\n' : ''}${c.org ? 'ORG:' + c.org + '\nTITLE:' + c.role : ''}
END:VCARD`}</div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, icon, color }) {
  return (
    <div className="row gap-3">
      <Icon name={icon} size={14} style={{ color: color || 'var(--ink-3)' }}/>
      <span style={{ width: 110, fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13.5, color: color || 'var(--ink)' }}>{value}</span>
    </div>
  );
}

// =========================================================================
// FILTERS (SIEVE)
// =========================================================================

function FiltersModule() {
  const [editing, setEditing] = React.useState(null);
  const [showRaw, setShowRaw] = React.useState(false);

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row gap-3" style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>Filters &amp; Rules</h1>
        <span className="t-mute t-sm" style={{ marginTop: 4 }}>Server-side Sieve · RFC 9661</span>
        <span className="flex-1"/>
        <button className="btn btn--outline" onClick={() => setShowRaw(v => !v)}>
          <Icon name="cube" size={13}/> {showRaw ? 'Visual editor' : 'Raw Sieve'}
        </button>
        <button className="btn btn--accent" onClick={() => setEditing('new')}><Icon name="plus" size={13}/> New rule</button>
      </div>

      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div className="col flex-1" style={{ overflowY: 'auto', padding: 24, gap: 16, minWidth: 0, background: 'var(--bg)' }}>
          {showRaw ? <RawSieveEditor/> : (
            <>
              <div className="col gap-2" style={{ maxWidth: 880 }}>
                <Banner kind="info" icon="info" title="Active filters run on every incoming message" body="They execute on the server (Sieve) — no client required."/>
                <div className="row gap-2" style={{ marginTop: 12, marginBottom: 4 }}>
                  <span className="serif" style={{ fontSize: 18 }}>Rules</span>
                  <span className="t-mute">·</span>
                  <span className="t-mute t-sm">{FILTERS_LIST.length} total · {FILTERS_LIST.filter(f => f.enabled).length} enabled</span>
                </div>
              </div>

              <div className="col gap-3" style={{ maxWidth: 880 }}>
                {FILTERS_LIST.map(f => <FilterCard key={f.id} filter={f}/>)}
              </div>

              <div className="col gap-3" style={{ maxWidth: 880, marginTop: 24 }}>
                <div className="serif" style={{ fontSize: 18 }}>Vacation responder</div>
                <VacationResponderCard/>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterCard({ filter }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
        <button style={{
          width: 32, height: 18, borderRadius: 999,
          background: filter.enabled ? 'var(--ok)' : 'var(--bg-active)',
          border: 'none', cursor: 'pointer', position: 'relative',
          flexShrink: 0, marginTop: 2,
        }}>
          <span style={{
            position: 'absolute', top: 2, left: filter.enabled ? 16 : 2,
            width: 14, height: 14, borderRadius: 999,
            background: 'white', transition: 'left 120ms',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}/>
        </button>

        <div className="col flex-1" style={{ gap: 8 }}>
          <div className="row gap-3">
            <span style={{ fontWeight: 600, fontSize: 14 }}>{filter.name}</span>
            {filter.hits > 0 && <span className="tag">{filter.hits} matches</span>}
            <span className="flex-1"/>
            <IconButton icon="copy" hint="Duplicate" size={26} iconSize={13}/>
            <IconButton icon="pencil" hint="Edit" size={26} iconSize={13}/>
            <IconButton icon="trash" hint="Delete" size={26} iconSize={13}/>
          </div>

          <div className="col gap-1.5" style={{ paddingLeft: 0 }}>
            <div className="row gap-2" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              <span style={{ fontWeight: 600, color: 'var(--ink-2)', minWidth: 30, textAlign: 'right' }}>WHEN</span>
              <div className="col" style={{ gap: 4, flex: 1 }}>
                {filter.when.map((c, i) => (
                  <div key={i} className="row gap-1" style={{ flexWrap: 'wrap' }}>
                    <span className="chip" style={{ fontWeight: 500 }}>{c.field}</span>
                    <span style={{ color: 'var(--ink-3)' }}>{c.op}</span>
                    <span className="chip mono" style={{ fontSize: 11 }}>{c.val}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="row gap-2" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              <span style={{ fontWeight: 600, color: 'var(--accent)', minWidth: 30, textAlign: 'right' }}>THEN</span>
              <div className="row gap-1" style={{ flex: 1, flexWrap: 'wrap' }}>
                {filter.then.map((t, i) => (
                  <span key={i} className="chip chip--on" style={{ background: 'var(--accent-tint)' }}>
                    {t.kind === 'tag' && <><Icon name="tag" size={10}/> Add tag <strong>{t.val}</strong></>}
                    {t.kind === 'move' && <><Icon name="folder" size={10}/> Move to <strong>{t.val}</strong></>}
                    {t.kind === 'star' && <><Icon name="star" size={10}/> Star</>}
                    {t.kind === 'mark-read' && <><Icon name="check" size={10}/> Mark read</>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VacationResponderCard() {
  const [on, setOn] = React.useState(false);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-3">
        <button onClick={() => setOn(!on)} style={{
          width: 32, height: 18, borderRadius: 999,
          background: on ? 'var(--ok)' : 'var(--bg-active)',
          border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, marginTop: 2,
        }}>
          <span style={{
            position: 'absolute', top: 2, left: on ? 16 : 2,
            width: 14, height: 14, borderRadius: 999,
            background: 'white', transition: 'left 120ms', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}/>
        </button>
        <div className="col flex-1" style={{ gap: 12 }}>
          <div className="row gap-2">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Out of office</span>
            {on && <span className="tag" style={{ background: 'var(--ok-tint)', color: 'var(--ok)' }}><span className="dot" style={{ background: 'var(--ok)' }}/> Active until 25 Jun</span>}
          </div>
          <div className="row gap-3">
            <Field label="Start"><input className="input" placeholder="22 Jun 2026" defaultValue="22 Jun 2026"/></Field>
            <Field label="End"><input className="input" placeholder="25 Jun 2026" defaultValue="25 Jun 2026"/></Field>
          </div>
          <Field label="Subject">
            <input className="input" placeholder="Out of office until 25 June" defaultValue="At the Roma reading retreat — back 25 Jun"/>
          </Field>
          <Field label="Body">
            <textarea className="input" style={{ height: 90, padding: 10, resize: 'vertical' }} defaultValue={`Thank you for writing. I'm at the Roma reading retreat through 25 June.\n\nFor urgent matters, please reach Marcus at marcus@saltnlightllc.com.\n\n— Aurelia`}/>
          </Field>
        </div>
      </div>
    </div>
  );
}

function RawSieveEditor() {
  const code = `require ["fileinto", "imap4flags", "x-stalwart-tag"];

# Auto-tag Tribunal
if address :contains "From" "@tribunal.saltnlightllc.com" {
    addflag "\\\\Flagged";
    addflag "Work";
    addflag "Urgent";
}

# GitHub notifications → Lab folder
if address :is "From" "notifications@github.com" {
    fileinto "Lab notes";
    setflag "\\\\Seen";
}

# Big PDFs from Volusianus → Invoices
if allof (
    address :contains "From" "@volusianus",
    size :over 1M,
    body :contains ".pdf"
) {
    fileinto "Invoices";
    addflag "Finance";
}

# Vacation responder (managed)
vacation
    :days 1
    :subject "At the Roma reading retreat — back 25 Jun"
    "Thank you for writing. I'm at the Roma reading retreat through 25 June.";`;
  return (
    <div className="card" style={{ maxWidth: 880, overflow: 'hidden' }}>
      <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
        <Icon name="cube" size={14} style={{ color: 'var(--ink-3)' }}/>
        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600 }}>sieve script · stored on OrdoEpistola</span>
        <span className="tag" style={{ marginLeft: 8, background: 'var(--ok-tint)', color: 'var(--ok)' }}><Icon name="check" size={10}/> syntax valid</span>
        <span className="flex-1"/>
        <button className="btn btn--ghost btn--sm"><Icon name="history" size={12}/> Revisions</button>
        <button className="btn btn--accent btn--sm">Save</button>
      </div>
      <pre className="mono" style={{ margin: 0, padding: 16, fontSize: 12, lineHeight: 1.7, color: 'var(--ink-2)', overflow: 'auto', maxHeight: 520 }}>
{code.split('\n').map((line, i) => {
  const isCmt = line.trim().startsWith('#');
  const isReq = line.startsWith('require');
  const isKw = /^(if|elsif|else|stop|require|allof|anyof|not|vacation)\b/.test(line.trim());
  return <div key={i} style={{ color: isCmt ? 'var(--ink-3)' : 'var(--ink-2)' }}>
    <span style={{ display: 'inline-block', width: 28, color: 'var(--ink-4)', userSelect: 'none' }}>{i + 1}</span>
    <span style={{ color: isReq ? 'var(--accent)' : isKw ? 'var(--t-violet)' : 'inherit' }}>{line}</span>
  </div>;
})}
      </pre>
    </div>
  );
}

// =========================================================================
// TEMPLATES
// =========================================================================

function TemplatesModule() {
  const [sel, setSel] = React.useState(TEMPLATES[0]);
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row gap-3" style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>Templates</h1>
        <span className="t-mute t-sm" style={{ marginTop: 4 }}>Reusable text with placeholders</span>
        <span className="flex-1"/>
        <button className="btn btn--accent"><Icon name="plus" size={13}/> New template</button>
      </div>
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div className="col" style={{ width: 320, background: 'var(--bg-elev)', borderRight: '1px solid var(--line)', overflowY: 'auto' }}>
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => setSel(t)} className="col gap-1" style={{
              width: '100%', padding: '12px 16px',
              background: sel?.id === t.id ? 'var(--bg-active)' : 'transparent',
              border: 'none', borderBottom: '1px solid var(--line)',
              cursor: 'pointer', textAlign: 'left',
            }}>
              <div className="row gap-2">
                <Icon name="template" size={13} style={{ color: 'var(--ink-3)' }}/>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</span>
              </div>
              <div className="t-mute truncate t-sm" style={{ paddingLeft: 21 }}>{t.body.split('\n')[0]}</div>
            </button>
          ))}
        </div>
        <div className="col flex-1" style={{ padding: 32, gap: 16, overflowY: 'auto', background: 'var(--bg)' }}>
          {sel && (
            <>
              <input className="input" defaultValue={sel.name} style={{ height: 38, fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-display)', border: 'none', padding: 0, background: 'transparent' }}/>
              <div className="card" style={{ padding: 16 }}>
                <textarea className="" defaultValue={sel.body} style={{
                  width: '100%', minHeight: 280, border: 'none', outline: 'none',
                  background: 'transparent', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: 'var(--ink)', resize: 'vertical',
                }}/>
              </div>
              <div className="row gap-2">
                <span className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Available placeholders:</span>
                {['{{recipientName}}', '{{date}}', '{{date+5d}}', '{{quarter}}', '{{project}}'].map(p => (
                  <code key={p} className="chip mono" style={{ fontSize: 11 }}>{p}</code>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// SETTINGS — Identity & Security & Plugins
// =========================================================================

function SettingsModule() {
  const [tab, setTab] = React.useState('identities');
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row" style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>Settings</h1>
      </div>
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div className="col" style={{ width: 220, padding: 12, gap: 2, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--line)' }}>
          {[
            ['identities', 'Identities & accounts', 'user'],
            ['security', 'Security & privacy', 'shield'],
            ['smime', 'S/MIME certificates', 'cert'],
            ['plugins', 'Plugins & marketplace', 'puzzle'],
            ['themes', 'Themes & branding', 'paint'],
            ['notifications', 'Notifications', 'bell'],
            ['keys', 'Keyboard shortcuts', 'keyR'],
            ['lang', 'Language', 'globe'],
            ['admin', 'Admin dashboard', 'settings'],
          ].map(([id, label, icon]) => (
            <NavRow key={id} icon={icon} label={label} active={tab === id} onClick={() => setTab(id)}/>
          ))}
        </div>
        <div className="col flex-1" style={{ overflowY: 'auto', padding: 32, background: 'var(--bg)' }}>
          {tab === 'identities' && <IdentitiesPanel/>}
          {tab === 'security' && <SecurityPrivacyPanel/>}
          {tab === 'smime' && <SmimePanel/>}
          {tab === 'plugins' && <PluginsPanel/>}
          {tab === 'themes' && <ThemesPanel/>}
          {tab === 'notifications' && <NotificationsPanel/>}
          {tab === 'keys' && <KeyboardPanel/>}
          {tab === 'lang' && <LanguagePanel/>}
          {tab === 'admin' && <AdminPanel/>}
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ title, desc, action }) {
  return (
    <div className="row gap-3" style={{ marginBottom: 20 }}>
      <div className="col flex-1" style={{ gap: 4 }}>
        <h2 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>{title}</h2>
        {desc && <div className="t-mute t-md">{desc}</div>}
      </div>
      {action}
    </div>
  );
}

function IdentitiesPanel() {
  return (
    <div className="col gap-6" style={{ maxWidth: 820 }}>
      <PanelHeader title="Accounts" desc="Multiple JMAP accounts can be active simultaneously." action={
        <button className="btn btn--accent"><Icon name="plus" size={13}/> Add account</button>
      }/>
      <div className="col gap-3">
        {ACCOUNTS.map(a => (
          <div key={a.id} className="card" style={{ padding: 16 }}>
            <div className="row gap-3">
              <Avatar name={a.name} size="lg" color={a.avatar} online/>
              <div className="col flex-1" style={{ gap: 2 }}>
                <div className="row gap-2">
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</span>
                  {a.primary && <span className="tag" style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}>Default</span>}
                  <span className="tag" style={{ background: 'var(--ok-tint)', color: 'var(--ok)' }}><span className="dot" style={{ background: 'var(--ok)' }}/> Connected</span>
                </div>
                <div className="t-mute t-sm">{a.email}</div>
                <div className="row gap-3 t-sm" style={{ marginTop: 6, color: 'var(--ink-3)' }}>
                  <span><Icon name="globe" size={11}/> mail.saltnlightllc.com</span>
                  <span><Icon name="shieldCheck" size={11}/> OAuth (Keycloak) + TOTP</span>
                  <span><Icon name="zap" size={11}/> Push enabled</span>
                </div>
              </div>
              <div className="row gap-1">
                <button className="btn btn--ghost btn--sm">Edit</button>
                <IconButton icon="moreV" iconSize={13} size={28}/>
              </div>
            </div>
          </div>
        ))}
      </div>

      <PanelHeader title="Sender identities" desc="One account can have multiple sender addresses with their own signature."/>
      <div className="col gap-2">
        {IDENTITIES.map(i => (
          <div key={i.id} className="card" style={{ padding: 14 }}>
            <div className="row gap-3">
              <Avatar name={i.from} size="md"/>
              <div className="col flex-1" style={{ gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{i.from} &lt;{i.email}&gt;</span>
                <span className="t-mute t-sm mono" style={{ fontSize: 11.5 }}>{i.signature}</span>
              </div>
              <div className="row gap-2">
                <span className="tag">Signature: above quote</span>
                <span className="tag"><Icon name="at" size={10}/> Sub-addressing on</span>
                <IconButton icon="pencil" iconSize={13} size={26}/>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SecurityPrivacyPanel() {
  return (
    <div className="col gap-6" style={{ maxWidth: 820 }}>
      <PanelHeader title="Security & privacy" desc="Authentication, sessions, and content blocking."/>

      <div className="card" style={{ padding: 16 }}>
        <div className="row gap-3" style={{ marginBottom: 12 }}>
          <Icon name="shieldCheck" size={20} style={{ color: 'var(--ok)' }}/>
          <div className="col flex-1" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>Two-factor authentication</span>
            <span className="t-mute t-sm">TOTP enrolled · 8 active recovery codes</span>
          </div>
          <span className="tag" style={{ background: 'var(--ok-tint)', color: 'var(--ok)' }}>Active</span>
          <button className="btn btn--ghost btn--sm">Manage</button>
        </div>
        <div className="divider" style={{ margin: '8px -16px' }}/>
        <div className="row gap-3" style={{ padding: '12px 0' }}>
          <Icon name="keyR" size={20} style={{ color: 'var(--ink-3)' }}/>
          <div className="col flex-1" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>OAuth app passwords</span>
            <span className="t-mute t-sm">3 active passwords for non-interactive tools (Thunderbird, K-9, mu)</span>
          </div>
          <button className="btn btn--outline btn--sm"><Icon name="plus" size={12}/> New password</button>
        </div>
        <div className="divider" style={{ margin: '8px -16px' }}/>
        <div className="row gap-3" style={{ padding: '12px 0' }}>
          <Icon name="cube" size={20} style={{ color: 'var(--ink-3)' }}/>
          <div className="col flex-1" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>Active sessions</span>
            <span className="t-mute t-sm">3 devices · Last sign-in just now from Berlin, DE</span>
          </div>
          <button className="btn btn--ghost btn--sm danger">Revoke all</button>
        </div>
      </div>

      <div className="col gap-3">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Content blocking</div>
        {[
          ['Block external content by default', 'Images, fonts, and tracking pixels are blocked unless the sender is trusted.', true],
          ['HTML email sanitization (DOMPurify)', 'Strip scripts, iframes, and event handlers from incoming HTML.', true],
          ['CSP with per-request nonces', 'Active for all rendered email frames and PDF previews.', true],
          ['Sandbox PDFs in cross-origin iframe', null, true],
          ['Newsletter "Unsubscribe" header (RFC 2369)', 'Show one-click unsubscribe button when present.', true],
        ].map(([t, d, on], i) => (
          <ToggleRow key={i} title={t} desc={d} value={on}/>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ title, desc, value }) {
  const [on, setOn] = React.useState(value);
  return (
    <div className="row gap-3 card" style={{ padding: 14 }}>
      <div className="col flex-1" style={{ gap: 2 }}>
        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{title}</span>
        {desc && <span className="t-mute t-sm">{desc}</span>}
      </div>
      <button onClick={() => setOn(!on)} style={{
        width: 32, height: 18, borderRadius: 999,
        background: on ? 'var(--ok)' : 'var(--bg-active)',
        border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 16 : 2,
          width: 14, height: 14, borderRadius: 999, background: 'white',
          transition: 'left 120ms', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}/>
      </button>
    </div>
  );
}

function SmimePanel() {
  return (
    <div className="col gap-6" style={{ maxWidth: 820 }}>
      <PanelHeader title="S/MIME certificates" desc="Per-account key isolation. Sign, encrypt, decrypt, and verify."
        action={<button className="btn btn--accent"><Icon name="upload" size={13}/> Import certificate</button>}/>

      <div className="card" style={{ padding: 18, borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
        <div className="row gap-3" style={{ marginBottom: 12 }}>
          <div style={{
            width: 40, height: 48, borderRadius: 4,
            background: 'var(--accent-tint)', color: 'var(--accent-ink)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="cert" size={24}/>
          </div>
          <div className="col flex-1" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>aurelia@saltnlightllc.com</span>
            <span className="t-mute t-sm mono" style={{ fontSize: 11 }}>SHA-256 9c:1f:32:4a:db:18:7e:5c:91:e0…</span>
            <div className="row gap-3 t-sm" style={{ marginTop: 4, color: 'var(--ink-3)' }}>
              <span>Issuer: Salt &amp; Light Internal CA</span>
              <span>·</span>
              <span>Expires: 2027-02-14</span>
            </div>
          </div>
          <span className="tag" style={{ background: 'var(--ok-tint)', color: 'var(--ok)' }}><Icon name="check" size={10}/> Valid</span>
        </div>
        <div className="row gap-2">
          <button className="btn btn--outline btn--sm"><Icon name="download" size={12}/> Export</button>
          <button className="btn btn--outline btn--sm"><Icon name="eye" size={12}/> View details</button>
          <button className="btn btn--ghost btn--sm danger"><Icon name="trash" size={12}/> Revoke</button>
          <span className="flex-1"/>
          <div className="row gap-3 t-sm" style={{ color: 'var(--ink-3)' }}>
            <span><Icon name="check" size={11} style={{ color: 'var(--ok)' }}/> sign</span>
            <span><Icon name="check" size={11} style={{ color: 'var(--ok)' }}/> encrypt</span>
            <span><Icon name="check" size={11} style={{ color: 'var(--ok)' }}/> decrypt</span>
          </div>
        </div>
      </div>

      <div className="col gap-3">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Send-mode defaults</div>
        <ToggleRow title="Sign outgoing messages by default" desc="When a private key is available for the sender identity." value={true}/>
        <ToggleRow title="Encrypt when recipient has a published cert" desc="Falls back to plain when no cert is published." value={true}/>
        <ToggleRow title="Allow legacy 3DES / PBE" desc="Required only for very old recipients. Off by default." value={false}/>
      </div>
    </div>
  );
}

function PluginsPanel() {
  return (
    <div className="col gap-6" style={{ maxWidth: 980 }}>
      <PanelHeader title="Plugins" desc="Extend Nuntius with hooks, composer slots, and event-banner widgets." action={
        <button className="btn btn--outline"><Icon name="external" size={13}/> Marketplace</button>
      }/>

      <div className="col gap-2">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Installed · {PLUGINS.length}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {PLUGINS.map(p => <PluginCard key={p.id} p={p}/>)}
        </div>
      </div>

      <div className="col gap-3">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>From the marketplace</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {[
            ['Tribunal cosign', 'Multi-party cryptographic stamp with audit anchor.', 'L. Lapidary'],
            ['Lyx / LaTeX preview', 'Render maths in the composer with KaTeX.', 'Universitas Scholastica'],
            ['Roma timezone helper', 'Auto-insert CET/CEST context for scheduling.', 'Independent'],
          ].map(([n, d, by]) => (
            <div key={n} className="card" style={{ padding: 14 }}>
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{n}</span>
                <span className="flex-1"/>
                <button className="btn btn--ghost btn--sm">Install</button>
              </div>
              <div className="t-mute t-sm" style={{ marginBottom: 8 }}>{d}</div>
              <div className="t-mute t-sm">by {by}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PluginCard({ p }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-2" style={{ marginBottom: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 6,
          background: p.official ? 'var(--accent-tint)' : 'var(--bg-active)',
          color: p.official ? 'var(--accent)' : 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="puzzle" size={16}/>
        </div>
        <div className="col flex-1" style={{ minWidth: 0 }}>
          <div className="row gap-1">
            <span style={{ fontWeight: 600, fontSize: 13.5 }} className="truncate">{p.name}</span>
            {p.official && <Icon name="shieldCheck" size={11} style={{ color: 'var(--accent)' }}/>}
          </div>
          <span className="t-mute t-sm">v{p.ver}{p.author ? ' · ' + p.author : ''}</span>
        </div>
        <button style={{
          width: 28, height: 16, borderRadius: 999,
          background: p.enabled ? 'var(--ok)' : 'var(--bg-active)',
          border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
        }}>
          <span style={{
            position: 'absolute', top: 2, left: p.enabled ? 14 : 2,
            width: 12, height: 12, borderRadius: 999, background: 'white',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}/>
        </button>
      </div>
      <div className="t-mute t-sm" style={{ minHeight: 32 }}>{p.desc}</div>
    </div>
  );
}

function ThemesPanel() {
  return (
    <div className="col gap-6" style={{ maxWidth: 820 }}>
      <PanelHeader title="Themes & branding" desc="Pick a theme or upload an admin theme bundle."/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {[
          ['Paper', '#FAF8F3', '#18181C', '#4F46E5', true],
          ['Ink', '#0C0C12', '#ECECF1', '#8B8BFF', false],
          ['Sepia', '#F1E8D4', '#2A2410', '#6E3F0F', false],
          ['Tribunal red', '#FAF8F3', '#18181C', '#B91C1C', false],
          ['Lapidary blue', '#F5F8FB', '#0F1E33', '#2563EB', false],
          ['Sage', '#F6F9F4', '#15291C', '#15803D', false],
        ].map(([n, bg, ink, ac, on]) => (
          <button key={n} style={{
            border: '2px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
            borderRadius: 12, padding: 0, cursor: 'pointer', background: 'var(--bg-elev)',
            textAlign: 'left', overflow: 'hidden',
          }}>
            <div style={{ height: 100, background: bg, padding: 10, position: 'relative' }}>
              <div style={{ width: 30, height: 8, borderRadius: 4, background: ink, opacity: 0.6, marginBottom: 6 }}/>
              <div style={{ width: 60, height: 6, borderRadius: 4, background: ink, opacity: 0.3, marginBottom: 4 }}/>
              <div style={{ width: 50, height: 6, borderRadius: 4, background: ink, opacity: 0.3 }}/>
              <div style={{ position: 'absolute', bottom: 10, right: 10, width: 24, height: 16, borderRadius: 4, background: ac }}/>
            </div>
            <div className="row gap-2" style={{ padding: '8px 12px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n}</span>
              {on && <span className="tag" style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}><Icon name="check" size={10}/> Active</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NotificationsPanel() {
  return (
    <div className="col gap-3" style={{ maxWidth: 820 }}>
      <PanelHeader title="Notifications" desc="Desktop, sound, and PWA push."/>
      <ToggleRow title="Desktop notifications" desc="Show a system toast when new mail arrives in Inbox or Imbox." value={true}/>
      <ToggleRow title="Sound" desc="Play a soft chime — pick from 7 included tones." value={true}/>
      <ToggleRow title="PWA push notifications" desc="Even when the tab is closed (requires server vapid keys)." value={true}/>
      <ToggleRow title="Quiet hours" desc="No sound or push between 22:00–07:00 local." value={true}/>
      <ToggleRow title="Notify on tagged mail only" desc="Silence newsletters and bulk mail." value={false}/>
    </div>
  );
}

function KeyboardPanel() {
  const groups = [
    ['Global', [['Search', '/'], ['Command palette', '⌘K'], ['Compose new', 'C'], ['Settings', 'G then S']]],
    ['Navigation', [['Next message', 'J'], ['Previous message', 'K'], ['Go to inbox', 'G then I'], ['Go to starred', 'G then *'], ['Go to sent', 'G then T'], ['Go to drafts', 'G then D']]],
    ['Mail actions', [['Reply', 'R'], ['Reply all', 'A'], ['Forward', 'F'], ['Archive', 'E'], ['Delete', '#'], ['Mark read/unread', 'Shift U'], ['Snooze', 'H'], ['Tag', 'L'], ['Move to', 'V'], ['Star', 'S']]],
    ['Selection', [['Select message', 'X'], ['Select all', '* then A'], ['Select unread', '* then U'], ['Select starred', '* then S']]],
    ['Composer', [['Send', '⌘↵'], ['Send later', '⌘⇧↵'], ['Discard', '⌘⇧D'], ['Save draft', '⌘S'], ['Attach', '⌘⇧A']]],
  ];
  return (
    <div className="col gap-6" style={{ maxWidth: 820 }}>
      <PanelHeader title="Keyboard shortcuts" desc="Press ? anywhere to see this in a modal."/>
      {groups.map(([g, items]) => (
        <div key={g} className="col gap-2">
          <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>{g}</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {items.map(([label, key], i) => (
              <div key={label} className="row gap-3" style={{
                padding: '10px 14px', borderBottom: i < items.length - 1 ? '1px solid var(--line)' : 'none',
              }}>
                <span className="flex-1" style={{ fontSize: 13 }}>{label}</span>
                {key.split(' ').map((k, j) => <span key={j} className="kbd">{k}</span>)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LanguagePanel() {
  const langs = ['English', 'Français', '日本語', 'Español', 'Italiano', 'Deutsch', 'Nederlands', 'Português', 'Русский', 'Türkçe', '한국어', 'Polski', 'Latviešu', '简体中文', 'Українська'];
  return (
    <div className="col gap-3" style={{ maxWidth: 820 }}>
      <PanelHeader title="Language" desc="15 languages — set globally or per browser."/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {langs.map((l, i) => (
          <button key={l} className={"row gap-2 card"} style={{
            padding: '10px 12px', cursor: 'pointer',
            border: '1px solid ' + (i === 0 ? 'var(--accent)' : 'var(--line)'),
            background: i === 0 ? 'var(--accent-tint)' : 'var(--bg-elev)',
          }}>
            {i === 0 && <Icon name="check" size={12} style={{ color: 'var(--accent)' }}/>}
            <span style={{ fontSize: 13, fontWeight: 500 }}>{l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminPanel() {
  return (
    <div className="col gap-6" style={{ maxWidth: 920 }}>
      <PanelHeader title="Admin dashboard" desc="Stalwart-style policies in one place."/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {[
          ['Domains', '4 active', 'globe'],
          ['Blocked IPs', '12,184', 'ban'],
          ['Queue depth', '2', 'send'],
          ['Failed auth (24h)', '37', 'shield'],
          ['Audit log entries', '46,221', 'history'],
          ['Push topics', '8', 'bell'],
        ].map(([t, v, i]) => (
          <div key={t} className="card" style={{ padding: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Icon name={i} size={16} style={{ color: 'var(--ink-3)' }}/>
              <button className="btn btn--ghost btn--icon btn--sm" style={{ width: 22, height: 22 }}><Icon name="external" size={11}/></button>
            </div>
            <div style={{ fontSize: 26, fontWeight: 600, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>{v}</div>
            <div className="t-mute t-sm">{t}</div>
          </div>
        ))}
      </div>
      <div className="col gap-3">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Recent events</div>
        <div className="card">
          {[
            ['10:42', 'Login from 78.46.114.22 · Berlin, DE', 'ok'],
            ['10:31', 'Sieve script updated by aurelia@…', 'info'],
            ['09:18', 'Blocked IP added: 185.220.101.34 (3 strikes)', 'warn'],
            ['08:55', 'Push notification topic /inbox/aurelia subscribed', 'info'],
            ['07:02', 'TLS certificate auto-renewed (mail.saltnlightllc.com)', 'ok'],
          ].map(([t, msg, kind], i) => (
            <div key={i} className="row gap-3" style={{ padding: '10px 14px', borderBottom: i < 4 ? '1px solid var(--line)' : 'none' }}>
              <span className="mono t-sm" style={{ color: 'var(--ink-3)', width: 36 }}>{t}</span>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: kind === 'ok' ? 'var(--ok)' : kind === 'warn' ? 'var(--warn)' : 'var(--accent)' }}/>
              <span style={{ fontSize: 13 }}>{msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ContactsModule, FiltersModule, TemplatesModule, SettingsModule });
