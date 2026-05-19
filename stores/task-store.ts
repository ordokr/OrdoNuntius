import { create } from 'zustand';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { debug, isDebugEnabled } from '@/lib/debug';

export type TaskViewFilter = 'all' | 'pending' | 'completed' | 'overdue';

interface TaskStore {
  tasks: CalendarTask[];
  selectedTaskId: string | null;
  filter: TaskViewFilter;
  showCompleted: boolean;
  isLoading: boolean;
  error: string | null;
  setTasks: (tasks: CalendarTask[]) => void;
  setSelectedTaskId: (id: string | null) => void;
  setFilter: (filter: TaskViewFilter) => void;
  setShowCompleted: (show: boolean) => void;
  fetchTasks: (client: IJMAPClient, calendarIds?: string[]) => Promise<void>;
  createTask: (client: IJMAPClient, task: Partial<CalendarTask>) => Promise<CalendarTask>;
  updateTask: (client: IJMAPClient, id: string, updates: Partial<CalendarTask>) => Promise<void>;
  deleteTask: (client: IJMAPClient, id: string) => Promise<void>;
  toggleTaskComplete: (client: IJMAPClient, task: CalendarTask) => Promise<void>;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  filter: 'all',
  showCompleted: false,
  isLoading: false,
  error: null,
  setTasks: (tasks) => set({ tasks }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setFilter: (filter) => set({ filter }),
  setShowCompleted: (show) => set({ showCompleted: show }),

  fetchTasks: async (client, calendarIds) => {
    debug.log('tasks', 'TaskStore/fetchTasks start', { calendarIds: calendarIds || 'all' });
    set({ isLoading: true, error: null });
    try {
      const tasks = await client.getCalendarTasks(calendarIds);
      debug.log('tasks', 'TaskStore/fetchTasks received', tasks.length, 'tasks');
      // Guard per-task debug payload behind isDebugEnabled. The forEach
      // and per-task object literal allocation ran regardless of whether
      // the tasks-debug category was on. With a 1000-task fetch that's
      // 1000 object literals per refetch.
      if (isDebugEnabled('tasks')) {
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i];
          debug.log('tasks', `TaskStore/fetchTasks [${i}]`, {
            id: t.id, uid: t.uid, '@type': t['@type'],
            title: t.title, due: t.due, progress: t.progress,
            showWithoutTime: t.showWithoutTime, calendarIds: t.calendarIds,
          });
        }
      }
      set({ tasks, isLoading: false });
    } catch (error) {
      debug.error('TaskStore/fetchTasks failed', error);
      set({ isLoading: false, error: 'Failed to fetch tasks' });
    }
  },

  createTask: async (client, task) => {
    debug.log('tasks', 'TaskStore/createTask', task);
    const created = await client.createCalendarTask(task);
    debug.log('tasks', 'TaskStore/createTask result', { id: created.id, uid: created.uid, title: created.title });
    set({ tasks: [...get().tasks, created] });
    return created;
  },

  updateTask: async (client, id, updates) => {
    // Optimistic update: flip local state before the server round-trip
    // so the UI feels instant. Snapshot the prior row so we can roll
    // back if the server rejects. Applies the RTT-min rule — the
    // perceived latency goes from "JMAP RTT" to ~0ms.
    const prev = get().tasks.find(t => t.id === id);
    if (!prev) {
      await client.updateCalendarTask(id, updates);
      return;
    }
    set({
      tasks: get().tasks.map(t => t.id === id ? { ...t, ...updates, updated: new Date().toISOString() } : t),
    });
    try {
      await client.updateCalendarTask(id, updates);
    } catch (error) {
      // Roll back to the snapshot
      set({ tasks: get().tasks.map(t => t.id === id ? prev : t) });
      throw error;
    }
  },

  deleteTask: async (client, id) => {
    const prev = get().tasks.find(t => t.id === id);
    const prevSelectedTaskId = get().selectedTaskId;
    if (!prev) {
      await client.deleteCalendarTask(id);
      return;
    }
    // Optimistic remove + selection clear; restore on server failure.
    set({
      tasks: get().tasks.filter(t => t.id !== id),
      selectedTaskId: prevSelectedTaskId === id ? null : prevSelectedTaskId,
    });
    try {
      await client.deleteCalendarTask(id);
    } catch (error) {
      set({
        tasks: [...get().tasks, prev],
        selectedTaskId: prevSelectedTaskId,
      });
      throw error;
    }
  },

  toggleTaskComplete: async (client, task) => {
    const newProgress = task.progress === 'completed' ? 'needs-action' : 'completed';
    const updates: Partial<CalendarTask> = {
      progress: newProgress,
      progressUpdated: new Date().toISOString(),
    };
    // Optimistic checkbox flip — the most user-visible UX of the lot.
    set({
      tasks: get().tasks.map(t => t.id === task.id ? { ...t, ...updates, updated: new Date().toISOString() } : t),
    });
    try {
      await client.updateCalendarTask(task.id, updates);
    } catch (error) {
      set({
        tasks: get().tasks.map(t => t.id === task.id ? task : t),
      });
      throw error;
    }
  },

  clearTasks: () => set({ tasks: [], selectedTaskId: null, error: null }),
}));
