"use client";

import { useCallback, useState, type CSSProperties, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { CalendarEvent, Calendar } from "@/lib/jmap/types";
import { format } from "date-fns";
import { Users } from "lucide-react";
import { getParticipantCount } from "@/lib/calendar-participants";
import { getEventEndDate, getEventStartDate } from "@/lib/calendar-utils";
import { useSettingsStore } from "@/stores/settings-store";

interface EventCardProps {
  event: CalendarEvent;
  calendar?: Calendar;
  variant: "chip" | "block" | "span";
  onClick?: (anchorRect: DOMRect) => void;
  onMouseEnter?: (anchorRect: DOMRect) => void;
  onMouseLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent, event: CalendarEvent) => void;
  isSelected?: boolean;
  draggable?: boolean;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  className?: string;
  style?: CSSProperties;
}

function sanitizeColor(color: string | null | undefined, fallback = "#3b82f6"): string {
  if (!color) return fallback;
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^(rgb|hsl)a?\([\d\s,.%/]+\)$/.test(color)) return color;
  return fallback;
}

function getEventColor(event: CalendarEvent, calendar?: Calendar): string {
  return sanitizeColor(event.color, sanitizeColor(calendar?.color));
}

// Single-regex ISO 8601 duration parser. Was 4 separate `duration.match(...)`
// calls per parse — each allocates a RegExpMatchArray. One match returns
// all components at once.
const DURATION_RE = /^P?(?:(\d+)W)?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
function parseDuration(duration: string | undefined): number {
  if (!duration) return 0;
  const m = DURATION_RE.exec(duration);
  if (!m) return 0;
  let total = 0;
  if (m[1]) total += parseInt(m[1]) * 7 * 24 * 60;
  if (m[2]) total += parseInt(m[2]) * 24 * 60;
  if (m[3]) total += parseInt(m[3]) * 60;
  if (m[4]) total += parseInt(m[4]);
  // S (seconds) intentionally ignored — caller works in minutes.
  return total;
}

function createEventDragPreview(title: string, timeRange: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; top: -9999px; left: 0;
    padding: 6px 12px; border-radius: 6px;
    background: ${color}40; border-left: 3px solid ${color};
    color: ${color}; font-size: 12px; font-weight: 500;
    max-width: 240px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; pointer-events: none; z-index: 9999;
  `;
  el.textContent = `${title} \u2022 ${timeRange}`;
  document.body.appendChild(el);
  return el;
}

export function EventCard({ event, calendar, variant, onClick, onMouseEnter, onMouseLeave, onContextMenu, isSelected, draggable: isDraggable, continuesBefore = false, continuesAfter = false, className, style }: EventCardProps) {
  const t = useTranslations("calendar");
  const [isBeingDragged, setIsBeingDragged] = useState(false);
  const color = getEventColor(event, calendar);
  const startDate = getEventStartDate(event);
  const timeFormat = useSettingsStore((state) => state.timeFormat);
  const showTimeInMonthView = useSettingsStore((state) => state.showTimeInMonthView);
  const timeFmt = timeFormat === "12h" ? "h:mm a" : "HH:mm";

  const calendarName = calendar?.name || "";
  const durationMinutes = parseDuration(event.duration);
  // Was: getEventEndDate(event) which calls getEventStartDate(event)
  // again (one extra parseISO per EventCard render). Since we already
  // have `startDate` and `durationMinutes`, derive end inline when
  // utcEnd is absent. Saves one parseISO per EventCard.
  const endTime = !event.showWithoutTime && event.utcEnd
    ? getEventEndDate(event) // parseISO of utcEnd — unavoidable
    : (event.duration ? new Date(startDate.getTime() + durationMinutes * 60000) : startDate);
  const timeString = `${format(startDate, timeFmt)} – ${format(endTime, timeFmt)}`;
  const ariaLabel = `${event.title || t("events.no_title")}, ${timeString}${calendarName ? `, ${calendarName}` : ""}`;
  const participantCount = getParticipantCount(event);

  const handleDragStart = useCallback((e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-calendar-event", JSON.stringify({
      type: "calendar-event",
      eventId: event.id,
      originalStart: event.start,
      duration: event.duration,
      durationMinutes,
    }));
    const displayTitle = event.title || t("events.no_title");
    e.dataTransfer.setData("text/plain", displayTitle);
    const preview = createEventDragPreview(displayTitle, timeString, color);
    e.dataTransfer.setDragImage(preview, 0, 0);
    requestAnimationFrame(() => preview.remove());
    setIsBeingDragged(true);
  }, [event, color, t, durationMinutes, timeString]);

  const handleDragEnd = useCallback(() => {
    setIsBeingDragged(false);
  }, []);

  const dragProps = isDraggable ? {
    draggable: true as const,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    "aria-roledescription": "draggable event",
  } : {};

  const handleContextMenu = onContextMenu ? (e: React.MouseEvent) => onContextMenu(e, event) : undefined;

  if (variant === "chip") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick?.(e.currentTarget.getBoundingClientRect()); }}
        onMouseEnter={(e) => onMouseEnter?.(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => onMouseLeave?.()}
        onContextMenu={handleContextMenu}
        aria-label={ariaLabel}
        {...dragProps}
        className={cn(
          "flex items-center gap-1 w-full text-left text-xs px-1 py-0.5 rounded truncate",
          "min-h-[44px] sm:min-h-0",
          "hover:opacity-80 transition-opacity",
          isSelected && "ring-2 ring-primary",
          isBeingDragged && "opacity-50",
          className
        )}
        style={{ backgroundColor: `${color}20`, color, ...style }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{event.title || t("events.no_title")}</span>
      </button>
    );
  }

  if (variant === "span") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick?.(e.currentTarget.getBoundingClientRect()); }}
        onMouseEnter={(e) => onMouseEnter?.(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => onMouseLeave?.()}
        onContextMenu={handleContextMenu}
        aria-label={ariaLabel}
        {...dragProps}
        className={cn(
          "w-full h-full text-left rounded-r px-1.5 py-0.5 text-xs overflow-hidden",
          "hover:opacity-90 transition-opacity cursor-pointer",
          continuesAfter && "rounded-r-sm",
          continuesBefore && "-ml-0.5",
          continuesAfter && "pr-2",
          isSelected && "ring-2 ring-primary",
          isBeingDragged && "opacity-50",
          className
        )}
        style={{ backgroundColor: `${color}24`, borderLeft: `3px solid ${color}`, color, ...style }}
      >
        <div className="flex items-center gap-1 min-w-0">
          {showTimeInMonthView && !event.showWithoutTime && (
            <span className="flex-shrink-0 opacity-80">{format(startDate, timeFmt)}</span>
          )}
          <span className="truncate font-medium">{event.title || t("events.no_title")}</span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e.currentTarget.getBoundingClientRect()); }}
      onMouseEnter={(e) => onMouseEnter?.(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onMouseLeave?.()}
      onContextMenu={handleContextMenu}
      aria-label={ariaLabel}
      {...dragProps}
      data-calendar-event
      className={cn(
        "w-full h-full text-left rounded-r px-1.5 py-0.5 text-xs overflow-hidden",
        "hover:opacity-90 transition-opacity cursor-pointer",
        isSelected && "ring-2 ring-primary",
        isBeingDragged && "opacity-50",
        className
      )}
      style={{ backgroundColor: `${color}30`, borderLeft: `3px solid ${color}`, color, ...style }}
    >
      <div className="font-medium truncate">{event.title || t("events.no_title")}</div>
      {!event.showWithoutTime && (
        <div className="opacity-80 text-[10px]">
          {timeString}
        </div>
      )}
      {participantCount > 0 && (
        <div
          className="flex items-center gap-0.5 opacity-70 text-[10px]"
          title={t("participants.count", { count: participantCount })}
        >
          <Users className="w-3 h-3" />
          <span>{participantCount}</span>
        </div>
      )}
    </button>
  );
}

export { parseDuration, getEventColor, sanitizeColor };
