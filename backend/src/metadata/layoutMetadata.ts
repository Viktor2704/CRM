/**
 * Layout Metadata System
 * Manages UI layout configurations for entities
 */

export interface LayoutMetadata {
  entityType: string;
  layouts: {
    list?: ListLayout;
    detail?: DetailLayout;
    detailSmall?: DetailLayout;
    edit?: EditLayout;
    editSmall?: EditLayout;
    filters?: FiltersLayout;
    massUpdate?: MassUpdateLayout;
    sidePanels?: SidePanelsLayout;
    bottomPanels?: BottomPanelsLayout;
  };
}

export interface ListLayout {
  columns: ListColumn[];
  defaultSort?: string;
  defaultOrder?: 'asc' | 'desc';
}

export interface ListColumn {
  name: string;
  label?: string;
  width?: string | number;
  sortable?: boolean;
  link?: boolean;
  align?: 'left' | 'center' | 'right';
  customView?: string;
}

export interface DetailLayout {
  rows: DetailRow[];
}

export interface DetailRow {
  cells: DetailCell[];
}

export interface DetailCell {
  name: string;
  label?: string;
  span?: number; // 1-12 (Bootstrap grid)
  customView?: string;
  customLabel?: string;
  readOnly?: boolean;
}

export interface EditLayout {
  rows: EditRow[];
}

export interface EditRow {
  cells: EditCell[];
}

export interface EditCell {
  name: string;
  label?: string;
  span?: number;
  customView?: string;
  customLabel?: string;
  readOnly?: boolean;
  required?: boolean;
}

export interface FiltersLayout {
  filters: FilterDefinition[];
}

export interface FilterDefinition {
  name: string;
  type: 'primary' | 'bool' | 'dropdown';
  label?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface MassUpdateLayout {
  fields: string[];
}

export interface SidePanelsLayout {
  detail?: SidePanel[];
  edit?: SidePanel[];
}

export interface SidePanel {
  name: string;
  label?: string;
  view?: string;
  reference?: string;
  disabled?: boolean;
  order?: number;
}

export interface BottomPanelsLayout {
  detail?: BottomPanel[];
  edit?: BottomPanel[];
}

export interface BottomPanel {
  name: string;
  label?: string;
  view?: string;
  reference?: string;
  disabled?: boolean;
  order?: number;
}

/**
 * Default layout templates
 */
export function createDefaultListLayout(fields: string[]): ListLayout {
  const columns: ListColumn[] = fields.slice(0, 5).map(field => ({
    name: field,
    sortable: true,
    link: field === 'name',
  }));

  return {
    columns,
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
  };
}

export function createDefaultDetailLayout(fields: string[]): DetailLayout {
  const rows: DetailRow[] = [];

  for (let i = 0; i < fields.length; i += 2) {
    const cells: DetailCell[] = [
      { name: fields[i], span: 6 },
    ];

    if (i + 1 < fields.length) {
      cells.push({ name: fields[i + 1], span: 6 });
    }

    rows.push({ cells });
  }

  return { rows };
}

export function createDefaultEditLayout(fields: string[]): EditLayout {
  const rows: EditRow[] = [];

  for (let i = 0; i < fields.length; i += 2) {
    const cells: EditCell[] = [
      { name: fields[i], span: 6 },
    ];

    if (i + 1 < fields.length) {
      cells.push({ name: fields[i + 1], span: 6 });
    }

    rows.push({ cells });
  }

  return { rows };
}

export function createDefaultLayoutMetadata(
  entityType: string,
  fields: string[]
): LayoutMetadata {
  // Filter out system fields for default layouts
  const editableFields = fields.filter(
    f => !['id', 'createdAt', 'modifiedAt', 'deleted', 'createdBy', 'modifiedBy'].includes(f)
  );

  return {
    entityType,
    layouts: {
      list: createDefaultListLayout(editableFields),
      detail: createDefaultDetailLayout(editableFields),
      edit: createDefaultEditLayout(editableFields),
      filters: {
        filters: [
          { name: 'all', type: 'primary', label: 'All' },
        ],
      },
      massUpdate: {
        fields: editableFields.slice(0, 10),
      },
    },
  };
}

/**
 * Validate layout metadata
 */
export function validateLayoutMetadata(
  layout: LayoutMetadata,
  availableFields: string[]
): string[] {
  const errors: string[] = [];
  const fieldSet = new Set(availableFields);

  // Validate list layout
  if (layout.layouts.list) {
    for (const column of layout.layouts.list.columns) {
      if (!fieldSet.has(column.name)) {
        errors.push(`List layout references unknown field: ${column.name}`);
      }
    }
  }

  // Validate detail layout
  if (layout.layouts.detail) {
    for (const row of layout.layouts.detail.rows) {
      for (const cell of row.cells) {
        if (!fieldSet.has(cell.name)) {
          errors.push(`Detail layout references unknown field: ${cell.name}`);
        }
      }
    }
  }

  // Validate edit layout
  if (layout.layouts.edit) {
    for (const row of layout.layouts.edit.rows) {
      for (const cell of row.cells) {
        if (!fieldSet.has(cell.name)) {
          errors.push(`Edit layout references unknown field: ${cell.name}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Merge layout updates
 */
export function mergeLayoutMetadata(
  base: LayoutMetadata,
  updates: Partial<LayoutMetadata>
): LayoutMetadata {
  return {
    entityType: updates.entityType || base.entityType,
    layouts: {
      ...base.layouts,
      ...updates.layouts,
    },
  };
}
