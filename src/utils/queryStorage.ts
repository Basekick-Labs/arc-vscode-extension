import * as vscode from 'vscode';

export interface QueryHistoryItem {
  id: string;
  query: string;
  database?: string;
  timestamp: number;
  executionTime?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  description?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Manages query history and saved queries using VS Code's global state
 */
export class QueryStorage {
  private context: vscode.ExtensionContext;
  private readonly HISTORY_KEY = 'arc.queryHistory';
  private readonly SAVED_KEY = 'arc.savedQueries';
  private readonly MAX_HISTORY_SIZE = 100;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Add a query to history
   */
  async addToHistory(item: Omit<QueryHistoryItem, 'id'>): Promise<void> {
    const history = this.getHistory();
    const newItem: QueryHistoryItem = {
      id: this.generateId(),
      ...item
    };

    // Add to beginning of array (most recent first)
    history.unshift(newItem);

    // Trim to max size
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.splice(this.MAX_HISTORY_SIZE);
    }

    await this.context.globalState.update(this.HISTORY_KEY, history);
  }

  /**
   * Get all query history
   */
  getHistory(): QueryHistoryItem[] {
    return this.context.globalState.get<QueryHistoryItem[]>(this.HISTORY_KEY, []);
  }

  /**
   * Clear query history
   */
  async clearHistory(): Promise<void> {
    await this.context.globalState.update(this.HISTORY_KEY, []);
  }

  /**
   * Delete a specific history item
   */
  async deleteHistoryItem(id: string): Promise<void> {
    const history = this.getHistory();
    const filtered = history.filter(item => item.id !== id);
    await this.context.globalState.update(this.HISTORY_KEY, filtered);
  }

  /**
   * Save a query with a name
   */
  async saveQuery(query: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedQuery> {
    const saved = this.getSavedQueries();
    const now = Date.now();
    const newQuery: SavedQuery = {
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
      ...query
    };

    saved.push(newQuery);
    await this.context.globalState.update(this.SAVED_KEY, saved);
    return newQuery;
  }

  /**
   * Update a saved query
   */
  async updateSavedQuery(id: string, updates: Partial<Omit<SavedQuery, 'id' | 'createdAt'>>): Promise<void> {
    const saved = this.getSavedQueries();
    const index = saved.findIndex(q => q.id === id);

    if (index >= 0) {
      saved[index] = {
        ...saved[index],
        ...updates,
        updatedAt: Date.now()
      };
      await this.context.globalState.update(this.SAVED_KEY, saved);
    }
  }

  /**
   * Get all saved queries
   */
  getSavedQueries(): SavedQuery[] {
    return this.context.globalState.get<SavedQuery[]>(this.SAVED_KEY, []);
  }

  /**
   * Delete a saved query
   */
  async deleteSavedQuery(id: string): Promise<void> {
    const saved = this.getSavedQueries();
    const filtered = saved.filter(q => q.id !== id);
    await this.context.globalState.update(this.SAVED_KEY, filtered);
  }

  /**
   * Search saved queries by name or tag
   */
  searchSavedQueries(searchTerm: string): SavedQuery[] {
    const saved = this.getSavedQueries();
    const term = searchTerm.toLowerCase();

    return saved.filter(q =>
      q.name.toLowerCase().includes(term) ||
      q.description?.toLowerCase().includes(term) ||
      q.tags?.some(tag => tag.toLowerCase().includes(term))
    );
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
