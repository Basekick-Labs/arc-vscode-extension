export interface ArcNotebookCell {
  type: 'markdown' | 'sql';
  content: string;
  output?: {
    columns?: string[];
    rows?: any[][];
    rowCount?: number;
    executionTime?: number;
    error?: string;
  };
  variables?: Record<string, any>;
}

export interface ArcNotebook {
  version: string;
  cells: ArcNotebookCell[];
  globalVariables?: Record<string, any>;
}
