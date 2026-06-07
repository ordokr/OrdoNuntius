/* eslint-disable */

// =========================================================================
// CALENDAR MODULE
// =========================================================================

function CalendarModule() {
  const [view, setView] = React.useState('month'); // month | week | day | agenda
  const today = new Date(2026, 4, 14);
  const [cursor, setCursor] = React.useState(new Date(2026, 4, 1));

  return (
    <div className="col" style={{ height: '100%', minHeight: 0 }}>
      <div className="row gap-3" style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>
          {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </h1>
        <div className="row gap-1" style={{ marginLeft: 8 }}>
          <IconButton icon="chevL" hint="Previous"/>
          <button className="btn btn--ghost">Today</button>
          <IconButton icon="chevR" hint="Next"/>
        </div>
        <span className="flex-1"/>
        <div className="row" style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: 2 }}>
          {['month', 'week', 'day', 'agenda'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="btn btn--sm"
              style={{
                height: 26, padding: '0 10px',
                background: view === v ? 'var(--bg-elev)' : 'transparent',
                color: view === v ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: view === v ? 'var(--shadow-1)' : 'none',
                fontWeight: view === v ? 600 : 500,
                textTransform: 'capitalize',
              }}
            >{v}</button>
          ))}
        </div>
        <div className="divider-v" style={{ height: 18, margin: '0 4px' }}/>
        <button className="btn btn--accent">
          <Icon name="plus" size={13}/> Event <span className="kbd" style={{ marginLeft: 4, background: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)', color: 'white' }}>N</span>
        </button>
      </div>
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <CalendarSidebar today={today}/>
        <div className="divider-v"/>
        <div className="flex-1" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--bg-elev)' }}>
          <MonthGrid today={today}/>
        </div>
      </div>
    </div>
  );
}

function CalendarSidebar({ today }) {
  return (
    <div className="col" style={{ width: 264, padding: 16, gap: 16, background: 'var(--bg-elev)', overflowY: 'auto' }}>
      <MiniMonth today={today}/>

      <div className="col gap-1">
        <div className="t-xs" style={{ color: 'var(--ink-3)', fontWeight: 600, padding: '6px 4px' }}>My calendars</div>
        {[
          ['Work', 'var(--t-blue)'],
          ['Lab', 'var(--t-violet)'],
          ['Personal', 'var(--t-pink)'],
          ['Compliance', 'var(--t-amber)'],
        ].map(([name, color]) => (
          <label key={name} className="row gap-2" style={{ padding: '4px 4px', cursor: 'pointer' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: color, border: '1.5px solid ' + color }}/>
            <span style={{ fontSize: 13 }}>{name}</span>
          </label>
        ))}
      </div>

      <div className="col gap-1">
        <div className="t-xs row" style={{ color: 'var(--ink-3)', fontWeight: 600, padding: '6px 4px', justifyContent: 'space-between' }}>
          <span>Subscribed</span>
          <Icon name="plus" size={12}/>
        </div>
        <label className="row gap-2" style={{ padding: '4px 4px' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--t-teal)', border: '1.5px solid var(--t-teal)' }}/>
          <span style={{ fontSize: 13 }}>Roman holidays (webcal)</span>
        </label>
        <label className="row gap-2" style={{ padding: '4px 4px' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'transparent', border: '1.5px solid var(--ink-4)' }}/>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Birthdays (auto)</span>
        </label>
      </div>

      <div className="col gap-2">
        <div className="t-xs row" style={{ color: 'var(--ink-3)', fontWeight: 600, padding: '6px 4px', justifyContent: 'space-between' }}>
          <span>Tasks · 4</span>
          <Icon name="plus" size={12}/>
        </div>
        {[
          ['Review Q2 procurement quotes', true, '#15803D'],
          ['Sign attestation packet', false, '#B45309'],
          ['Reserve room — Roma reading', false, null],
          ['Reply to Clemens re: engagement', false, '#B91C1C'],
        ].map(([t, done, pri], i) => (
          <label key={i} className="row gap-2" style={{ padding: '4px 4px', cursor: 'pointer' }}>
            <span style={{
              width: 14, height: 14, borderRadius: 4,
              border: '1.5px solid ' + (done ? 'var(--ok)' : 'var(--ink-4)'),
              background: done ? 'var(--ok)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{done && <Icon name="check" size={9} style={{ color: 'white', strokeWidth: 3 }}/>}</span>
            <span style={{ fontSize: 12.5, color: done ? 'var(--ink-4)' : 'var(--ink-2)', textDecoration: done ? 'line-through' : 'none', flex: 1 }}>{t}</span>
            {pri && <span style={{ width: 6, height: 6, borderRadius: 999, background: pri }}/>}
          </label>
        ))}
      </div>
    </div>
  );
}

function MiniMonth({ today }) {
  const month = today.getMonth();
  const year = today.getFullYear();
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // Mon-start
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="col gap-1">
      <div className="row gap-2" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
        <span className="serif" style={{ fontSize: 14, fontWeight: 500 }}>
          {today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </span>
        <div className="row gap-0">
          <button className="btn btn--ghost btn--icon" style={{ width: 18, height: 18 }}><Icon name="chevL" size={11}/></button>
          <button className="btn btn--ghost btn--icon" style={{ width: 18, height: 18 }}><Icon name="chevR" size={11}/></button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--ink-4)', fontWeight: 600, padding: '4px 0' }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const isToday = d === today.getDate();
          const hasEvt = d && [14, 15, 16, 19, 21, 22, 23, 24, 25, 31].includes(d);
          return (
            <button key={i} disabled={!d} style={{
              aspectRatio: '1', border: 'none', background: 'transparent', cursor: d ? 'pointer' : 'default',
              fontSize: 11.5, fontWeight: isToday ? 700 : 500,
              color: !d ? 'transparent' : isToday ? 'white' : 'var(--ink-2)',
              borderRadius: 4,
              position: 'relative',
              ...(isToday && { background: 'var(--wax)' }),
            }}>
              {d}
              {hasEvt && !isToday && <span style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: 999, background: 'var(--accent)' }}/>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthGrid({ today }) {
  const month = today.getMonth();
  const year = today.getFullYear();
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = startDay - 1; i >= 0; i--) cells.push({ d: new Date(year, month, -i).getDate(), out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, out: false });
  while (cells.length < 42) cells.push({ d: cells.length - startDay - daysInMonth + 1, out: true });

  const eventsByDay = {};
  EVENTS.forEach(e => {
    const d = new Date(e.start).getDate();
    if (!eventsByDay[d]) eventsByDay[d] = [];
    eventsByDay[d].push(e);
  });

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row" style={{ borderBottom: '1px solid var(--line)' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={{ flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{d}</div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, 1fr)' }}>
        {cells.map((c, i) => {
          const isToday = !c.out && c.d === today.getDate();
          const evts = !c.out && eventsByDay[c.d] || [];
          return (
            <div key={i} style={{
              borderRight: i % 7 !== 6 ? '1px solid var(--line)' : 'none',
              borderBottom: '1px solid var(--line)',
              padding: 6,
              background: isToday ? 'var(--wax-tint)' : 'transparent',
              overflow: 'hidden',
              minHeight: 0,
            }}>
              <div style={{
                fontSize: 11.5, fontWeight: isToday ? 700 : 500,
                color: c.out ? 'var(--ink-4)' : isToday ? 'var(--wax)' : 'var(--ink-2)',
                marginBottom: 4,
              }}>{c.d}</div>
              <div className="col" style={{ gap: 2 }}>
                {evts.slice(0, 3).map(e => (
                  <div key={e.id} className="row gap-1 truncate" style={{
                    fontSize: 10.5, fontWeight: 500,
                    padding: '2px 5px', borderRadius: 3,
                    background: 'color-mix(in srgb, ' + e.color + ' 14%, transparent)',
                    color: e.color,
                    borderLeft: '2px solid ' + e.color,
                    cursor: 'pointer',
                  }}>
                    {!e.allDay && <span style={{ fontSize: 9, opacity: 0.7 }}>{new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
                    <span className="truncate">{e.title}</span>
                    {e.imip && <Icon name="users" size={9}/>}
                  </div>
                ))}
                {evts.length > 3 && <div style={{ fontSize: 10, color: 'var(--ink-3)', padding: '0 5px' }}>+{evts.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// FILES MODULE
// =========================================================================

function FilesModule() {
  const [view, setView] = React.useState('grid');
  const [folder, setFolder] = React.useState(null);

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row gap-3" style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>Files</h1>
        <span className="t-mute t-sm" style={{ marginTop: 4 }}>
          OrdoEpistola FileNode · <span style={{ color: 'var(--ink-2)' }}>32.4 GB</span> of 100 GB
        </span>
        <span className="flex-1"/>
        <div className="row" style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: 2 }}>
          {['grid', 'list'].map(v => (
            <button key={v} onClick={() => setView(v)} className="btn btn--ghost btn--icon btn--sm" style={{
              background: view === v ? 'var(--bg-elev)' : 'transparent',
              boxShadow: view === v ? 'var(--shadow-1)' : 'none',
              width: 26, height: 26,
            }}>
              <Icon name={v === 'grid' ? 'grid' : 'list'} size={13}/>
            </button>
          ))}
        </div>
        <button className="btn btn--outline"><Icon name="upload" size={13}/> Upload</button>
        <button className="btn btn--accent"><Icon name="plus" size={13}/> New folder</button>
      </div>

      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div className="col" style={{ width: 240, padding: 12, gap: 4, borderRight: '1px solid var(--line)', background: 'var(--bg-sidebar)', overflowY: 'auto' }}>
          <NavRow icon="folder" label="All files" count={210} active={!folder} onClick={() => setFolder(null)}/>
          <NavRow icon="star" label="Favorites" count={8}/>
          <NavRow icon="history" label="Recent" count={24}/>
          <NavRow icon="users" label="Shared with me" count={12}/>
          <NavRow icon="trash" label="Trash" count={3}/>
          <SectionLabel action="plus">Folders</SectionLabel>
          {FILE_FOLDERS.map(f => (
            <NavRow key={f.id} icon="folder" label={f.name} count={f.count} color={f.color}
              active={folder === f.id} onClick={() => setFolder(f.id)}/>
          ))}
          <div className="card" style={{ margin: '12px 8px', padding: 12, background: 'var(--bg)' }}>
            <div className="row gap-2" style={{ marginBottom: 8 }}>
              <Icon name="cloud" size={14}/>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Storage</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-active)', overflow: 'hidden' }}>
              <div style={{ width: '32%', height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }}/>
            </div>
            <div className="row" style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)', justifyContent: 'space-between' }}>
              <span>32.4 GB used</span><span>100 GB</span>
            </div>
          </div>
        </div>

        <div className="col flex-1" style={{ minWidth: 0, background: 'var(--bg)', padding: 24, overflowY: 'auto' }}>
          <div className="row gap-2 t-sm" style={{ color: 'var(--ink-3)', marginBottom: 16 }}>
            <span>All files</span>
            <Icon name="chevR" size={10}/>
            <span>Inbox 14 May 2026</span>
          </div>

          <SectionLabel>Today</SectionLabel>
          {view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {FILES.slice(0, 3).map(f => <FileCard key={f.id} file={f}/>)}
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {FILES.slice(0, 3).map(f => <FileRow key={f.id} file={f}/>)}
            </div>
          )}

          <SectionLabel>Earlier</SectionLabel>
          {view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {FILES.slice(3).map(f => <FileCard key={f.id} file={f}/>)}
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {FILES.slice(3).map(f => <FileRow key={f.id} file={f}/>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileCard({ file }) {
  return (
    <div className="card" style={{ padding: 12, cursor: 'pointer' }}>
      <div style={{
        height: 100, borderRadius: 6, marginBottom: 10,
        background: 'color-mix(in srgb, ' + file.color + ' 8%, var(--bg))',
        border: '1px dashed color-mix(in srgb, ' + file.color + ' 25%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <div style={{
          padding: '6px 10px', borderRadius: 4,
          background: file.color, color: 'white',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
        }}>{file.name.split('.').pop().toUpperCase()}</div>
        {file.shared && <Icon name="users" size={11} style={{ position: 'absolute', top: 8, right: 8, color: 'var(--ink-3)' }}/>}
      </div>
      <div className="truncate" style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 2 }}>{file.name}</div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)' }}>
        <span>{file.size}</span><span>{file.mtime}</span>
      </div>
    </div>
  );
}

function FileRow({ file }) {
  return (
    <div className="row gap-3" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
      <div style={{
        width: 28, height: 36, borderRadius: 3,
        background: 'color-mix(in srgb, ' + file.color + ' 14%, transparent)',
        color: file.color, fontSize: 9, fontWeight: 700,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
      }}>{file.name.split('.').pop().toUpperCase()}</div>
      <div className="flex-1 truncate" style={{ fontSize: 13, fontWeight: 500 }}>{file.name}</div>
      {file.shared && <span className="tag"><Icon name="users" size={10}/> Shared</span>}
      <span className="t-mute t-sm" style={{ width: 60, textAlign: 'right' }}>{file.size}</span>
      <span className="t-mute t-sm" style={{ width: 60, textAlign: 'right' }}>{file.mtime}</span>
      <IconButton icon="moreV" iconSize={13} size={26}/>
    </div>
  );
}

Object.assign(window, { CalendarModule, FilesModule });
