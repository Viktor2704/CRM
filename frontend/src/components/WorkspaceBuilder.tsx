import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

interface Widget {
  id: string;
  type: string;
  title: string;
  position: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  config?: any;
}

interface WorkspaceBuilderProps {
  workspaceId?: string;
  initialLayout?: any;
  onSave?: (layout: any) => void;
}

const WIDGET_TYPES = [
  { id: 'stat-card', name: 'Stat Card', icon: '📊' },
  { id: 'chart', name: 'Chart', icon: '📈' },
  { id: 'list', name: 'List', icon: '📋' },
  { id: 'calendar', name: 'Calendar', icon: '📅' },
  { id: 'feed', name: 'Activity Feed', icon: '📰' },
  { id: 'kanban', name: 'Kanban Board', icon: '🗂️' },
  { id: 'table', name: 'Table', icon: '📑' },
];

export default function WorkspaceBuilder({ workspaceId: _workspaceId, initialLayout, onSave }: WorkspaceBuilderProps) {
  const [widgets, setWidgets] = useState<Widget[]>(initialLayout?.widgets || []);
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const addWidget = (type: string) => {
    const newWidget: Widget = {
      id: `widget-${Date.now()}`,
      type,
      title: `New ${type}`,
      position: {
        x: 0,
        y: widgets.length * 2,
        w: 6,
        h: 4,
      },
    };
    setWidgets([...widgets, newWidget]);
    setIsDirty(true);
  };

  const removeWidget = (widgetId: string) => {
    setWidgets(widgets.filter(w => w.id !== widgetId));
    setIsDirty(true);
  };

  const updateWidget = (widgetId: string, updates: Partial<Widget>) => {
    setWidgets(widgets.map(w => w.id === widgetId ? { ...w, ...updates } : w));
    setIsDirty(true);
  };

  const handleSave = async () => {
    const layout = {
      widgets,
      layout_config: {
        cols: 12,
        rowHeight: 60,
      },
    };

    if (onSave) {
      await onSave(layout);
      setIsDirty(false);
    }
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(widgets);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setWidgets(items);
    setIsDirty(true);
  };

  return (
    <div className="workspace-builder">
      <div className="builder-header">
        <h2>Workspace Builder</h2>
        <div className="builder-actions">
          {isDirty && <span className="unsaved-indicator">Unsaved changes</span>}
          <button onClick={handleSave} className="btn btn-primary" disabled={!isDirty}>
            Save Layout
          </button>
        </div>
      </div>

      <div className="builder-content">
        <div className="widget-palette">
          <h3>Add Widgets</h3>
          <div className="widget-types">
            {WIDGET_TYPES.map(type => (
              <button
                key={type.id}
                className="widget-type-btn"
                onClick={() => addWidget(type.id)}
                title={type.name}
              >
                <span className="widget-icon">{type.icon}</span>
                <span className="widget-name">{type.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="workspace-canvas">
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="widgets">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="widgets-container"
                >
                  {widgets.map((widget, index) => (
                    <Draggable key={widget.id} draggableId={widget.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`widget-item ${selectedWidget === widget.id ? 'selected' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
                          onClick={() => setSelectedWidget(widget.id)}
                        >
                          <div className="widget-header">
                            <span className="widget-title">{widget.title}</span>
                            <div className="widget-controls">
                              <button
                                className="btn-icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeWidget(widget.id);
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          <div className="widget-body">
                            <div className="widget-preview">
                              {widget.type} widget preview
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {widgets.length === 0 && (
            <div className="empty-canvas">
              <p>Add widgets from the palette to build your workspace</p>
            </div>
          )}
        </div>

        {selectedWidget && (
          <div className="widget-properties">
            <h3>Widget Properties</h3>
            {(() => {
              const widget = widgets.find(w => w.id === selectedWidget);
              if (!widget) return null;

              return (
                <div className="properties-form">
                  <div className="form-group">
                    <label>Title</label>
                    <input
                      type="text"
                      value={widget.title}
                      onChange={(e) => updateWidget(widget.id, { title: e.target.value })}
                      className="form-control"
                    />
                  </div>
                  <div className="form-group">
                    <label>Width (columns)</label>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={widget.position.w}
                      onChange={(e) => updateWidget(widget.id, {
                        position: { ...widget.position, w: parseInt(e.target.value) }
                      })}
                      className="form-control"
                    />
                  </div>
                  <div className="form-group">
                    <label>Height (rows)</label>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={widget.position.h}
                      onChange={(e) => updateWidget(widget.id, {
                        position: { ...widget.position, h: parseInt(e.target.value) }
                      })}
                      className="form-control"
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <style>{`
        .workspace-builder {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .builder-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          border-bottom: 1px solid #e5e7eb;
        }

        .builder-actions {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .unsaved-indicator {
          color: #f59e0b;
          font-size: 0.875rem;
        }

        .builder-content {
          flex: 1;
          display: grid;
          grid-template-columns: 200px 1fr 250px;
          gap: 1rem;
          padding: 1rem;
          overflow: hidden;
        }

        .widget-palette {
          border-right: 1px solid #e5e7eb;
          padding-right: 1rem;
        }

        .widget-types {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .widget-type-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
          background: white;
          cursor: pointer;
          transition: all 0.2s;
        }

        .widget-type-btn:hover {
          background: #f3f4f6;
          border-color: #3b82f6;
        }

        .workspace-canvas {
          overflow-y: auto;
          padding: 1rem;
          background: #f9fafb;
          border-radius: 0.5rem;
        }

        .widgets-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          min-height: 200px;
        }

        .widget-item {
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 1rem;
          cursor: move;
          transition: all 0.2s;
        }

        .widget-item.selected {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .widget-item.dragging {
          opacity: 0.5;
        }

        .widget-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .widget-title {
          font-weight: 600;
        }

        .widget-body {
          padding: 1rem;
          background: #f9fafb;
          border-radius: 0.25rem;
          min-height: 100px;
        }

        .empty-canvas {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 300px;
          color: #9ca3af;
        }

        .widget-properties {
          border-left: 1px solid #e5e7eb;
          padding-left: 1rem;
        }

        .properties-form {
          margin-top: 1rem;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .form-control {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
        }

        .btn {
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          border: none;
          cursor: pointer;
          font-weight: 500;
        }

        .btn-primary {
          background: #3b82f6;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #2563eb;
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-icon {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0.25rem;
          color: #6b7280;
        }

        .btn-icon:hover {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
