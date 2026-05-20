"use client";

// Tiny picker for the 16 preset calendar colors. Split out of
// components/settings/calendar-management-settings.tsx (~766 LOC + heavy
// transitive pulls: ShareCollectionDialog, ICalImportModal,
// ICalSubscriptionModal, calendar-store) so consumers that only need the
// picker (calendar-sidebar-panel on the eager calendar route path, plus
// create-calendar-modal / ical-subscription-modal) don't drag the entire
// settings module into the calendar route bundle.

import { cn } from "@/lib/utils";

export const CALENDAR_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#6366f1", // indigo
  "#a855f7", // purple
  "#e11d48", // rose
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#d946ef", // fuchsia
];

interface CalendarColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  allowCustom?: boolean;
}

export function CalendarColorPicker({ value, onChange, allowCustom }: CalendarColorPickerProps) {
  const selectedIsPreset = CALENDAR_COLORS.includes(value);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CALENDAR_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            "w-6 h-6 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            value === color && "ring-2 ring-offset-2 ring-offset-background ring-foreground"
          )}
          style={{ backgroundColor: color }}
          aria-label={color}
        />
      ))}
      {allowCustom && (
        <label
          className={cn(
            "relative w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 overflow-hidden border-2 border-dashed border-muted-foreground/40",
            !selectedIsPreset && value && "ring-2 ring-offset-2 ring-offset-background ring-foreground"
          )}
          style={!selectedIsPreset && value ? { backgroundColor: value } : undefined}
          title="Custom color"
        >
          <input
            type="color"
            value={value || "#3b82f6"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          {(selectedIsPreset || !value) && (
            <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs font-bold">+</span>
          )}
        </label>
      )}
    </div>
  );
}
