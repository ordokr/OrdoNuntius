"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Search, BookUser, Trash2, Users, Download, X, UserPlus, CheckSquare, Square, Filter, Mail, Phone, Image as ImageIcon, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ContactListItem } from "./contact-list-item";
import { ContactContextMenu } from "./contact-context-menu";
import { useContextMenu } from "@/hooks/use-context-menu";
import { cn, hasAnyKey } from "@/lib/utils";
import type { AnniversaryDate, ContactCard } from "@/lib/jmap/types";
import { getContactDisplayName, getContactPhotoUri } from "@/stores/contact-store";
import { useSettingsStore } from "@/stores/settings-store";

type TriState = boolean | null;

interface ListFilters {
  organization: string;
  jobTitle: string;
  location: string;
  emailDomain: string;
  birthdayMonth: number | null;
  hasEmail: TriState;
  hasPhone: TriState;
  hasPhoto: TriState;
}

const EMPTY_FILTERS: ListFilters = {
  organization: "",
  jobTitle: "",
  location: "",
  emailDomain: "",
  birthdayMonth: null,
  hasEmail: null,
  hasPhone: null,
  hasPhoto: null,
};

function cycleTri(v: TriState): TriState {
  return v === null ? true : v === true ? false : null;
}

function countActiveFilters(f: ListFilters): number {
  let n = 0;
  if (f.organization.trim()) n++;
  if (f.jobTitle.trim()) n++;
  if (f.location.trim()) n++;
  if (f.emailDomain.trim()) n++;
  if (f.birthdayMonth !== null) n++;
  if (f.hasEmail !== null) n++;
  if (f.hasPhone !== null) n++;
  if (f.hasPhoto !== null) n++;
  return n;
}

function matchTri(actual: boolean, filter: TriState): boolean {
  if (filter === null) return true;
  return actual === filter;
}

function getAnniversaryMonth(date: AnniversaryDate): number | null {
  if (typeof date === "string") {
    const iso = date.match(/^(\d{4})-(\d{2})/);
    if (iso) return parseInt(iso[2], 10);
    const partial = date.match(/^--(\d{2})/);
    if (partial) return parseInt(partial[1], 10);
    return null;
  }
  if ("month" in date && date.month) return date.month;
  if ("utc" in date && date.utc) {
    const d = new Date(date.utc);
    return isNaN(d.getTime()) ? null : d.getMonth() + 1;
  }
  return null;
}

function ToggleChip({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: TriState; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors border",
        value === true && "bg-primary/10 border-primary/30 text-primary",
        value === false && "bg-muted border-border text-muted-foreground line-through",
        value === null && "bg-background border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface ContactListProps {
  contacts: ContactCard[];
  selectedContactId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectContact: (id: string) => void;
  onCreateNew: () => void;
  className?: string;
  selectedContactIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onSelectRangeContacts: (id: string, sortedIds: string[]) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  onBulkAddToGroup: () => void;
  onBulkExport: () => void;
  onEditContact: (id: string) => void;
  onDeleteContact: (contact: ContactCard) => void;
  onAddContactToGroup: (id: string) => void;
}

export function ContactList({
  contacts,
  selectedContactId,
  searchQuery,
  onSearchChange,
  onSelectContact,
  onCreateNew,
  className,
  selectedContactIds,
  onToggleSelection,
  onSelectRangeContacts,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  onBulkAddToGroup,
  onBulkExport,
  onEditContact,
  onDeleteContact,
  onAddContactToGroup,
}: ContactListProps) {
  const t = useTranslations("contacts");
  const locale = useLocale();
  const density = useSettingsStore((state) => state.density);
  const groupByLetter = useSettingsStore((state) => state.groupContactsByLetter);
  const { contextMenu, openContextMenu, closeContextMenu, menuRef } = useContextMenu<ContactCard>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const activeFilters = countActiveFilters(filters);

  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: "long" });
    return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2000, i, 1)));
  }, [locale]);

  const filtered = useMemo(() => {
    const lower = searchQuery.trim().toLowerCase();
    const orgLower = filters.organization.trim().toLowerCase();
    const jobLower = filters.jobTitle.trim().toLowerCase();
    const locLower = filters.location.trim().toLowerCase();
    const domainLower = filters.emailDomain.trim().toLowerCase().replace(/^@/, "");

    // Each contact-filter pass previously allocated 6 Object.values arrays
    // (emails, phones, orgs, titles, addresses, anniversaries) UPFRONT
    // before any filter ran. Walk each Record with for...in inline; use
    // shared `hasAnyKey` from @/lib/utils for presence checks (avoids
    // re-creating a helper closure on each useMemo run).
    return contacts.filter((c) => {
      if (!matchTri(hasAnyKey(c.emails), filters.hasEmail)) return false;
      if (!matchTri(hasAnyKey(c.phones), filters.hasPhone)) return false;
      if (!matchTri(!!getContactPhotoUri(c), filters.hasPhoto)) return false;

      if (orgLower) {
        let match = false;
        const orgs = c.organizations;
        if (orgs) {
          for (const k in orgs) {
            const o = orgs[k];
            if (o.name?.toLowerCase().includes(orgLower)) { match = true; break; }
            if (o.units?.some((u) => u.name?.toLowerCase().includes(orgLower))) { match = true; break; }
          }
        }
        if (!match) return false;
      }

      if (jobLower) {
        let match = false;
        const titles = c.titles;
        if (titles) {
          for (const k in titles) {
            if (titles[k].name?.toLowerCase().includes(jobLower)) { match = true; break; }
          }
        }
        if (!match) return false;
      }

      if (locLower) {
        let match = false;
        const addresses = c.addresses;
        if (addresses) {
          outer:
          for (const k in addresses) {
            const a = addresses[k];
            // Inline includes checks against each field instead of
            // building a parts[] array per address.
            if (a.full?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.fullAddress?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.locality?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.region?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.country?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.postcode?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.street?.toLowerCase().includes(locLower)) { match = true; break; }
            if (a.components) {
              for (const comp of a.components) {
                if (comp.value?.toLowerCase().includes(locLower)) { match = true; break outer; }
              }
            }
          }
        }
        if (!match) return false;
      }

      if (domainLower) {
        let match = false;
        const emails = c.emails;
        if (emails) {
          for (const k in emails) {
            const at = emails[k].address?.toLowerCase().split("@");
            if (at && at.length > 1 && at[1].includes(domainLower)) { match = true; break; }
          }
        }
        if (!match) return false;
      }

      if (filters.birthdayMonth !== null) {
        const target = filters.birthdayMonth;
        let match = false;
        const anniversaries = c.anniversaries;
        if (anniversaries) {
          for (const k in anniversaries) {
            const a = anniversaries[k];
            if (a.kind === "birth" && getAnniversaryMonth(a.date) === target) { match = true; break; }
          }
        }
        if (!match) return false;
      }

      if (!lower) return true;
      const name = getContactDisplayName(c).toLowerCase();
      if (name.includes(lower)) return true;
      if (c.emails) {
        for (const k in c.emails) {
          if (c.emails[k].address?.toLowerCase().includes(lower)) return true;
        }
      }
      if (c.phones) {
        for (const k in c.phones) {
          if (c.phones[k].number?.toLowerCase().includes(lower)) return true;
        }
      }
      if (c.organizations) {
        for (const k in c.organizations) {
          if (c.organizations[k].name?.toLowerCase().includes(lower)) return true;
        }
      }
      return false;
    });
  }, [contacts, searchQuery, filters]);

  // Schwartzian: decorate once with both the lowercase name (for sort)
  // and the trimmed display name (for grouping). Was computing
  // `getContactDisplayName(...)` per comparison (so O(N log N) times)
  // PLUS again per item in groupedSections. Now exactly once per item.
  const sortedDecorated = useMemo(() => {
    const decorated = filtered.map(contact => {
      const display = getContactDisplayName(contact);
      return { contact, lower: display.toLowerCase(), trimmed: display.trim() };
    });
    decorated.sort((a, b) => a.lower.localeCompare(b.lower));
    return decorated;
  }, [filtered]);

  const sorted = useMemo(() => sortedDecorated.map(d => d.contact), [sortedDecorated]);
  const sortedIds = useMemo(() => sorted.map(c => c.id), [sorted]);

  // Group sorted contacts by first letter of display name. Non-letter
  // starters (digits, symbols, empty) collect under "#" which sorts last.
  // Reuses the decorate-once display name from sortedDecorated.
  const groupedSections = useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    const groups = new Map<string, ContactCard[]>();
    for (const { contact, trimmed } of sortedDecorated) {
      const first = trimmed.charAt(0);
      const letter = first && first.toLocaleUpperCase(locale).match(/\p{L}/u)
        ? first.toLocaleUpperCase(locale)
        : "#";
      const bucket = groups.get(letter);
      if (bucket) bucket.push(contact);
      else groups.set(letter, [contact]);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === "#") return 1;
        if (b === "#") return -1;
        return collator.compare(a, b);
      })
      .map(([letter, items]) => ({ letter, items }));
  }, [sortedDecorated, locale]);

  const hasSelection = selectedContactIds.size > 0;
  const allSelected = sorted.length > 0 && sorted.every(c => selectedContactIds.has(c.id));

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar: select / search / filter */}
      <div className="border-b border-border bg-background">
        <div className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (hasSelection) {
                  if (allSelected) onClearSelection();
                  else onSelectAll(sortedIds);
                } else if (sortedIds.length > 0) {
                  const target = selectedContactId && sortedIds.includes(selectedContactId)
                    ? selectedContactId
                    : sortedIds[0];
                  onToggleSelection(target);
                }
              }}
              className={cn(
                "flex-shrink-0 p-2 rounded-md transition-colors",
                hasSelection
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              title={hasSelection ? (allSelected ? t("bulk.clear") : t("bulk.select_all")) : t("filters.select")}
            >
              {hasSelection ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t("search_placeholder")}
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className={cn("pl-9 h-9", searchQuery && "pr-8")}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t("clear_search")}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn(
                "relative flex-shrink-0 p-2 rounded-md transition-colors",
                filtersOpen || activeFilters > 0
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              title={t("filters.toggle")}
              aria-label={t("filters.toggle")}
            >
              <Filter className="w-4 h-4" />
              {!filtersOpen && activeFilters > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
                  {activeFilters}
                </span>
              )}
            </button>
          </div>
        </div>

      </div>

      {filtersOpen && (
        <div className="border-b border-border bg-muted/30 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t("filters.title")}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="h-7 px-2 text-xs"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  {t("filters.clear")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setFiltersOpen(false)}
                  className="h-7 w-7"
                  aria-label={t("filters.close")}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("filters.organization")}</label>
                <Input
                  value={filters.organization}
                  onChange={(e) => setFilters((f) => ({ ...f, organization: e.target.value }))}
                  placeholder={t("filters.organization_placeholder")}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("filters.job_title")}</label>
                <Input
                  value={filters.jobTitle}
                  onChange={(e) => setFilters((f) => ({ ...f, jobTitle: e.target.value }))}
                  placeholder={t("filters.job_title_placeholder")}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("filters.location")}</label>
                <Input
                  value={filters.location}
                  onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))}
                  placeholder={t("filters.location_placeholder")}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("filters.email_domain")}</label>
                <Input
                  value={filters.emailDomain}
                  onChange={(e) => setFilters((f) => ({ ...f, emailDomain: e.target.value }))}
                  placeholder={t("filters.email_domain_placeholder")}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t("filters.birthday_month")}</label>
              <select
                value={filters.birthdayMonth ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, birthdayMonth: e.target.value === "" ? null : Number(e.target.value) }))}
                className="h-8 w-full text-sm rounded-md border border-input bg-background px-2"
                aria-label={t("filters.birthday_month")}
              >
                <option value="">{t("filters.any_month")}</option>
                {monthNames.map((name, i) => (
                  <option key={i} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <ToggleChip
                icon={<Mail className="w-3.5 h-3.5" />}
                label={t("filters.has_email")}
                value={filters.hasEmail}
                onClick={() => setFilters((f) => ({ ...f, hasEmail: cycleTri(f.hasEmail) }))}
              />
              <ToggleChip
                icon={<Phone className="w-3.5 h-3.5" />}
                label={t("filters.has_phone")}
                value={filters.hasPhone}
                onClick={() => setFilters((f) => ({ ...f, hasPhone: cycleTri(f.hasPhone) }))}
              />
              <ToggleChip
                icon={<ImageIcon className="w-3.5 h-3.5" />}
                label={t("filters.has_photo")}
                value={filters.hasPhoto}
                onClick={() => setFilters((f) => ({ ...f, hasPhoto: cycleTri(f.hasPhoto) }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="px-3 py-1.5 border-b border-border bg-accent/30 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              if (allSelected) {
                onClearSelection();
              } else {
                onSelectAll(sortedIds);
              }
            }}
            className="p-1 rounded hover:bg-muted/50 transition-colors"
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          <span className="text-xs font-medium text-foreground">
            {t("bulk.selected", { count: selectedContactIds.size })}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onBulkAddToGroup} className="h-7 text-xs">
            <Users className="w-3.5 h-3.5 mr-1" />
            {t("bulk.add_to_group")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBulkExport} className="h-7 text-xs">
            <Download className="w-3.5 h-3.5 mr-1" />
            {t("bulk.export")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkDelete}
            className="h-7 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            {t("bulk.delete")}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClearSelection} className="h-7 w-7">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            {searchQuery || activeFilters > 0 ? (
              <>
                {activeFilters > 0 && !searchQuery ? (
                  <Filter className="w-10 h-10 mb-3 text-muted-foreground/30" />
                ) : (
                  <Search className="w-10 h-10 mb-3 text-muted-foreground/30" />
                )}
                <p className="text-sm font-medium text-foreground">
                  {searchQuery ? t("empty_search") : t("empty_filtered")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {searchQuery ? t("empty_search_hint") : t("empty_filtered_hint")}
                </p>
                <div className="flex gap-2 mt-3">
                  {searchQuery && (
                    <Button variant="outline" size="sm" onClick={() => onSearchChange("")}>
                      {t("clear_search")}
                    </Button>
                  )}
                  {activeFilters > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      {t("filters.clear")}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <BookUser className="w-10 h-10 mb-3 text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground">{t("empty_state_title")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("empty_state_subtitle")}</p>
                <Button size="sm" className="mt-3" onClick={onCreateNew}>
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  {t("create_new")}
                </Button>
              </>
            )}
          </div>
        ) : (
          (() => {
            const renderItem = (contact: ContactCard) => (
              <ContactListItem
                key={contact.id}
                contact={contact}
                isSelected={contact.id === selectedContactId}
                isChecked={selectedContactIds.has(contact.id)}
                hasSelection={hasSelection}
                density={density}
                selectedContactIds={selectedContactIds}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    onToggleSelection(contact.id);
                  } else if (e.shiftKey) {
                    e.preventDefault();
                    onSelectRangeContacts(contact.id, sortedIds);
                  } else {
                    if (hasSelection) onClearSelection();
                    onSelectContact(contact.id);
                  }
                }}
                onCheckboxClick={(e) => {
                  e.stopPropagation();
                  onToggleSelection(contact.id);
                }}
                onContextMenu={(e, c) => openContextMenu(e, c)}
              />
            );
            return groupByLetter ? (
              <div>
                {groupedSections.map(({ letter, items }) => (
                  <section key={letter}>
                    <div className="sticky top-0 z-10 px-4 py-0.5 bg-background/90 backdrop-blur-sm text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                      {letter}
                    </div>
                    {items.map(renderItem)}
                  </section>
                ))}
              </div>
            ) : (
              <div>{sorted.map(renderItem)}</div>
            );
          })()
        )}
      </div>

      {contextMenu.data && (
        <ContactContextMenu
          contact={contextMenu.data}
          position={contextMenu.position}
          isOpen={contextMenu.isOpen}
          onClose={closeContextMenu}
          menuRef={menuRef}
          isMultiSelect={selectedContactIds.has(contextMenu.data.id)}
          selectedCount={selectedContactIds.size}
          onOpen={() => onSelectContact(contextMenu.data!.id)}
          onEdit={() => onEditContact(contextMenu.data!.id)}
          onDelete={() => onDeleteContact(contextMenu.data!)}
          onAddToGroup={() => onAddContactToGroup(contextMenu.data!.id)}
          onBatchExport={onBulkExport}
          onBatchAddToGroup={onBulkAddToGroup}
          onBatchDelete={onBulkDelete}
        />
      )}
    </div>
  );
}
