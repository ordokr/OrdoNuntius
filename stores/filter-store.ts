import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { FilterRule, SieveCapabilities, VacationSieveConfig } from '@/lib/jmap/sieve-types';
// parseScript (778 LOC) and generateScript (242 LOC) are heavy Sieve
// language tools used only inside the async fetchFilters / saveFilters
// actions below. filter-store itself is pulled into every authenticated
// route's boot bundle via auth-store + account-state-manager, so eager
// imports would drag ~1020 LOC of parser/generator into the cold-load
// even when the JMAP server doesn't support Sieve at all.
// Lazy-loaded at call time below.
import { debug } from '@/lib/debug';

interface FilterStore {
  rules: FilterRule[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  isSupported: boolean;
  sieveCapabilities: SieveCapabilities | null;
  activeScriptId: string | null;
  isOpaque: boolean;
  rawScript: string;
  vacationSettings: VacationSieveConfig | null;
  externalRequires: string[];

  setSupported: (supported: boolean) => void;
  fetchFilters: (client: IJMAPClient) => Promise<void>;
  saveFilters: (client: IJMAPClient) => Promise<void>;
  validateScript: (client: IJMAPClient, content: string) => Promise<{ isValid: boolean; errors?: string[] }>;
  addRule: (rule: FilterRule) => void;
  updateRule: (ruleId: string, updates: Partial<FilterRule>) => void;
  deleteRule: (ruleId: string) => void;
  reorderRules: (ruleIds: string[]) => void;
  toggleRule: (ruleId: string) => void;
  setRawScript: (content: string) => void;
  resetToVisualBuilder: () => void;
  clearState: () => void;
}

export const useFilterStore = create<FilterStore>()((set, get) => ({
  rules: [],
  isLoading: false,
  isSaving: false,
  error: null,
  isSupported: false,
  sieveCapabilities: null,
  activeScriptId: null,
  isOpaque: false,
  rawScript: '',
  vacationSettings: null,
  externalRequires: [],

  setSupported: (supported) => set({ isSupported: supported }),

  fetchFilters: async (client) => {
    set({ isLoading: true, error: null });
    try {
      const capabilities = client.getSieveCapabilities();
      set({ sieveCapabilities: capabilities });

      const allScripts = await client.getSieveScripts();
      debug.log('filters', 'Sieve scripts fetched:', allScripts.length);

      // Skip the server-managed 'vacation' script (RFC 9661 §4) - it can only
      // be modified via VacationResponse/set, not SieveScript/set.
      const scripts = allScripts.filter(s => s.name !== 'vacation');

      const activeScript = scripts.find(s => s.isActive) || scripts[0];
      if (!activeScript) {
        set({ isLoading: false, rules: [], activeScriptId: null, rawScript: '', isOpaque: false });
        return;
      }

      set({ activeScriptId: activeScript.id });

      // Fan out the parser fetch in parallel with the script-content RTT.
      const [content, { parseScript }] = await Promise.all([
        client.getSieveScriptContent(activeScript.blobId),
        import('@/lib/sieve/parser'),
      ]);
      set({ rawScript: content });

      const result = parseScript(content);

      if (result.isOpaque) {
        debug.log('filters', 'Sieve script is opaque (hand-edited)');
        set({
          isLoading: false,
          isOpaque: true,
          rules: [],
          vacationSettings: result.vacation || null,
          externalRequires: result.externalRequires,
        });
      } else {
        debug.log('filters', 'Parsed', result.rules.length, 'filter rules');
        set({
          isLoading: false,
          isOpaque: false,
          rules: result.rules,
          vacationSettings: result.vacation || null,
          externalRequires: result.externalRequires,
        });
      }
    } catch (error) {
      debug.error('Failed to fetch filters:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch filters',
      });
    }
  },

  saveFilters: async (client) => {
    set({ isSaving: true, error: null });
    try {
      const { isOpaque, rawScript, rules, activeScriptId, vacationSettings, externalRequires } = get();

      let content: string;
      if (isOpaque) {
        content = rawScript;
      } else {
        const { generateScript } = await import('@/lib/sieve/generator');
        content = generateScript(rules, vacationSettings || undefined, { externalRequires });
      }

      if (activeScriptId) {
        await client.updateSieveScript(activeScriptId, content, true);
      } else {
        const script = await client.createSieveScript('filters', content, true);
        set({ activeScriptId: script.id });
      }

      set({ isSaving: false, rawScript: content });
      debug.log('filters', 'Filters saved successfully');
    } catch (error) {
      debug.error('Failed to save filters:', error);
      set({
        isSaving: false,
        error: error instanceof Error ? error.message : 'Failed to save filters',
      });
      throw error;
    }
  },

  validateScript: async (client, content) => {
    return client.validateSieveScript(content);
  },

  addRule: (rule) => {
    // Insert new ordoNuntius rules before external/opaque rules so OrdoNuntius's
    // managed section stays contiguous. Single-pass partition — was 2 filter
    // walks over the same rules array.
    set((state) => {
      const ordoNuntius: FilterRule[] = [];
      const external: FilterRule[] = [];
      for (const r of state.rules) {
        (r.origin === 'external' || r.origin === 'opaque' ? external : ordoNuntius).push(r);
      }
      return { rules: [...ordoNuntius, rule, ...external] };
    });
  },

  updateRule: (ruleId, updates) => {
    set((state) => ({
      rules: state.rules.map(r => {
        if (r.id !== ruleId) return r;
        if (r.origin === 'external' || r.origin === 'opaque') return r; // read-only
        return { ...r, ...updates };
      }),
    }));
  },

  deleteRule: (ruleId) => {
    set((state) => ({
      rules: state.rules.filter(r => {
        if (r.id !== ruleId) return true;
        return r.origin === 'external' || r.origin === 'opaque';
      }),
    }));
  },

  reorderRules: (ruleIds) => {
    // Only reorder ordoNuntius rules; external rules always stay at the end in
    // their original order. Single-pass partition + Map build avoids the
    // 3 separate `.filter()/.map()` allocations the old version did.
    set((state) => {
      const ordoNuntiusMap = new Map<string, FilterRule>();
      const external: FilterRule[] = [];
      for (const r of state.rules) {
        if (r.origin === 'external' || r.origin === 'opaque') external.push(r);
        else ordoNuntiusMap.set(r.id, r);
      }
      const reordered: FilterRule[] = [];
      for (const id of ruleIds) {
        const r = ordoNuntiusMap.get(id);
        if (r) reordered.push(r);
      }
      return { rules: [...reordered, ...external] };
    });
  },

  toggleRule: (ruleId) => {
    set((state) => ({
      rules: state.rules.map(r => {
        if (r.id !== ruleId) return r;
        if (r.origin === 'external' || r.origin === 'opaque') return r; // read-only
        return { ...r, enabled: !r.enabled };
      }),
    }));
  },

  setRawScript: (content) => set({ rawScript: content }),

  resetToVisualBuilder: () => set({ isOpaque: false, rawScript: '', rules: [], externalRequires: [] }),

  clearState: () => set({
    rules: [],
    isLoading: false,
    isSaving: false,
    error: null,
    isSupported: false,
    sieveCapabilities: null,
    activeScriptId: null,
    isOpaque: false,
    rawScript: '',
    vacationSettings: null,
    externalRequires: [],
  }),
}));
