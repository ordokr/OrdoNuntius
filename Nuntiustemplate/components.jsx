/* eslint-disable */
// Shared atom components

function Avatar({ name, size = 'sm', online, color, src, square }) {
  const bg = color || avFor(name || '?');
  const init = initials(name || '?');
  return (
    <span
      className={"avatar avatar--" + size + (online ? " online" : "")}
      style={{ background: bg, borderRadius: square ? 6 : 999 }}
    >
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', borderRadius: 'inherit' }}/> : init}
    </span>
  );
}

function TagPill({ tagId, removable, onRemove }) {
  const t = TAGS.find(x => x.id === tagId);
  if (!t) return null;
  return (
    <span className="tag" style={{
      background: 'color-mix(in srgb, ' + t.color + ' 14%, var(--bg-elev))',
      color: t.color,
      borderRadius: 4, padding: '1px 6px', fontWeight: 500,
      border: '1px solid color-mix(in srgb, ' + t.color + ' 30%, transparent)',
    }}>
      <span className="tag-dot" style={{ background: t.color, width: 6, height: 6 }} />
      {t.name}
      {removable && <button className="row" style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer', opacity: 0.7 }} onClick={onRemove}><Icon name="x" size={10}/></button>}
    </span>
  );
}

function ToolButton({ icon, label, onClick, hint, active, danger, className = "", iconSize, children }) {
  return (
    <button
      className={"btn btn--ghost " + className + (active ? " is-active" : "") + (danger ? " btn--danger" : "")}
      onClick={onClick}
      title={hint ? label + " (" + hint + ")" : label}
      style={active ? { background: 'var(--bg-active)', color: 'var(--ink)' } : undefined}
    >
      {icon && <Icon name={icon} size={iconSize || 15} />}
      {label && <span>{label}</span>}
      {children}
    </button>
  );
}

function IconButton({ icon, onClick, hint, active, danger, size = 30, iconSize = 15 }) {
  return (
    <button
      className={"btn btn--ghost btn--icon" + (danger ? " btn--danger" : "")}
      onClick={onClick}
      title={hint}
      style={{ width: size, height: size, background: active ? 'var(--bg-active)' : undefined }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

function SectionLabel({ children, action, onAction }) {
  return (
    <div className="row" style={{
      padding: '12px 16px 6px',
      justifyContent: 'space-between',
      color: 'var(--ink-3)',
    }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {children}
      </span>
      {action && (
        <button className="btn btn--ghost btn--icon" style={{ width: 20, height: 20, color: 'var(--ink-4)' }} onClick={onAction}>
          <Icon name={action} size={12} />
        </button>
      )}
    </div>
  );
}

function NavRow({ icon, label, count, unreadCount, active, color, onClick, indent = 0 }) {
  return (
    <button
      onClick={onClick}
      className="row gap-3"
      style={{
        width: '100%',
        height: 30,
        padding: '0 12px 0 ' + (12 + indent) + 'px',
        background: active ? 'var(--bg-active)' : 'transparent',
        border: 'none',
        borderRadius: 6,
        margin: '1px 8px',
        cursor: 'pointer',
        textAlign: 'left',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        fontWeight: active ? 600 : 500,
        fontSize: 13,
        width: 'calc(100% - 16px)',
        transition: 'background 80ms',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && <Icon name={icon} size={15} style={{ color: color || (active ? 'var(--ink)' : 'var(--ink-3)') }} />}
      <span className="flex-1 truncate" style={{ textAlign: 'left' }}>{label}</span>
      {unreadCount > 0 ? (
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: 'var(--wax)',
          fontVariantNumeric: 'tabular-nums',
        }}>{unreadCount}</span>
      ) : count != null ? (
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      ) : null}
    </button>
  );
}

// Time formatting (relative + absolute)
function fmtTime(ts, opts = {}) {
  const now = NOW;
  const diff = (now - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 24 * 3600) return Math.floor(diff / 3600) + 'h';
  if (diff < 7 * 24 * 3600) return Math.floor(diff / (24 * 3600)) + 'd';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function fmtFullTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Popover (anchored)
function Popover({ open, onClose, anchor = 'tl', children, style }) {
  if (!open) return null;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={onClose} />
      <div
        className="card scale-in"
        style={{
          position: 'absolute',
          ...(anchor.includes('t') ? { top: 'calc(100% + 4px)' } : { bottom: 'calc(100% + 4px)' }),
          ...(anchor.includes('r') ? { right: 0 } : { left: 0 }),
          minWidth: 200,
          boxShadow: 'var(--shadow-3)',
          padding: 4,
          zIndex: 100,
          ...style,
        }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}

function MenuItem({ icon, label, hint, kbd, danger, onClick, checked }) {
  return (
    <button
      onClick={onClick}
      className="row gap-3"
      style={{
        width: '100%', minWidth: 200,
        padding: '6px 10px',
        border: 'none', background: 'transparent',
        borderRadius: 4,
        textAlign: 'left',
        cursor: 'pointer',
        color: danger ? 'var(--danger)' : 'var(--ink)',
        fontSize: 13,
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {checked !== undefined && (
        <Icon name="check" size={13} style={{ color: checked ? 'var(--accent)' : 'transparent' }} />
      )}
      {icon && <Icon name={icon} size={14} style={{ color: 'var(--ink-3)' }} />}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="t-mute" style={{ fontSize: 11 }}>{hint}</span>}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--line)', margin: '4px -4px' }} />;
}

// Tiny toast/banner host
function Banner({ kind = 'info', icon, title, body, action, onAction, onClose }) {
  const tints = { info: 'accent', ok: 'ok', warn: 'warn', danger: 'danger' };
  const t = tints[kind];
  return (
    <div className="row gap-3" style={{
      padding: '10px 14px',
      background: 'var(--' + t + '-tint)',
      border: '1px solid color-mix(in srgb, var(--' + t + ') 30%, transparent)',
      borderRadius: 8,
      color: 'var(--' + t + ')',
      fontSize: 13,
    }}>
      {icon && <Icon name={icon} size={16} />}
      <div className="col flex-1" style={{ gap: 1 }}>
        {title && <div style={{ fontWeight: 600 }}>{title}</div>}
        {body && <div style={{ color: 'var(--ink-2)' }}>{body}</div>}
      </div>
      {action && <button className="btn btn--sm btn--outline" onClick={onAction}>{action}</button>}
      {onClose && <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose}><Icon name="x" size={12}/></button>}
    </div>
  );
}

// Search/Find divider, etc.
function SecurityBadge({ kind }) {
  if (kind === 'signed') {
    return (
      <span className="row gap-1" title="Signed (S/MIME) — verified" style={{
        padding: '2px 6px', borderRadius: 4, fontSize: 10.5,
        background: 'var(--ok-tint)', color: 'var(--ok)', fontWeight: 600,
        letterSpacing: '0.02em',
      }}>
        <Icon name="shieldCheck" size={11} strokeWidth={2}/> SIGNED
      </span>
    );
  }
  if (kind === 'encrypted') {
    return (
      <span className="row gap-1" title="End-to-end encrypted (S/MIME)" style={{
        padding: '2px 6px', borderRadius: 4, fontSize: 10.5,
        background: 'var(--accent-tint)', color: 'var(--accent-ink)', fontWeight: 600,
      }}>
        <Icon name="lock" size={11} strokeWidth={2}/> ENCRYPTED
      </span>
    );
  }
  return null;
}

Object.assign(window, {
  Avatar, TagPill, ToolButton, IconButton, SectionLabel, NavRow,
  fmtTime, fmtFullTime, Popover, MenuItem, MenuDivider, Banner, SecurityBadge,
});
