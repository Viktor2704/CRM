import { useState } from 'react';

type EmailBuilderProps = {
  initialDesign?: EmailTemplateDesign;
  onChange: (design: EmailTemplateDesign, html: string) => void;
};

type EmailTemplateDesign = {
  version: string;
  body: {
    rows: EmailTemplateRow[];
    values: {
      backgroundColor?: string;
      contentWidth?: string;
      fontFamily?: string;
      textColor?: string;
      linkColor?: string;
    };
  };
};

type EmailTemplateRow = {
  id: string;
  cells: EmailTemplateCell[];
  values: {
    backgroundColor?: string;
    padding?: string;
  };
};

type EmailTemplateCell = {
  id: string;
  contents: EmailTemplateContent[];
  values: {
    width?: string;
    backgroundColor?: string;
    padding?: string;
  };
};

type EmailTemplateContent = {
  id: string;
  type: 'text' | 'image' | 'button' | 'divider' | 'spacer' | 'html';
  values: Record<string, any>;
};

export default function EmailBuilder({ initialDesign, onChange }: EmailBuilderProps) {
  const [design, setDesign] = useState<EmailTemplateDesign>(
    initialDesign || {
      version: '1.0',
      body: {
        rows: [],
        values: {
          backgroundColor: '#f4f4f4',
          contentWidth: '600px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          textColor: '#333333',
          linkColor: '#1a73e8',
        },
      },
    }
  );

  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedContentIndex, setSelectedContentIndex] = useState<number | null>(null);

  const generateId = () => Math.random().toString(36).substring(2, 11);

  const addRow = () => {
    const newRow: EmailTemplateRow = {
      id: generateId(),
      cells: [
        {
          id: generateId(),
          contents: [],
          values: {
            width: '100%',
            padding: '10px',
          },
        },
      ],
      values: {
        padding: '10px',
      },
    };

    const newDesign = {
      ...design,
      body: {
        ...design.body,
        rows: [...design.body.rows, newRow],
      },
    };

    setDesign(newDesign);
    onChange(newDesign, '');
  };

  const addContent = (rowIndex: number, type: EmailTemplateContent['type']) => {
    const newContent: EmailTemplateContent = {
      id: generateId(),
      type,
      values: getDefaultContentValues(type),
    };

    const newRows = [...design.body.rows];
    newRows[rowIndex].cells[0].contents.push(newContent);

    const newDesign = {
      ...design,
      body: {
        ...design.body,
        rows: newRows,
      },
    };

    setDesign(newDesign);
    onChange(newDesign, '');
  };

  const getDefaultContentValues = (type: EmailTemplateContent['type']) => {
    switch (type) {
      case 'text':
        return {
          text: 'Введите текст здесь',
          fontSize: '14px',
          color: '#333333',
          lineHeight: '1.5',
        };
      case 'image':
        return {
          src: 'https://via.placeholder.com/600x200',
          alt: 'Image',
          width: '100%',
        };
      case 'button':
        return {
          text: 'Нажмите здесь',
          url: '#',
          backgroundColor: '#1a73e8',
          color: '#ffffff',
          fontSize: '16px',
          padding: '12px 24px',
          borderRadius: '4px',
        };
      case 'divider':
        return {
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: '#e0e0e0',
          margin: '20px 0',
        };
      case 'spacer':
        return {
          height: '20px',
        };
      case 'html':
        return {
          html: '<p>Custom HTML</p>',
        };
      default:
        return {};
    }
  };

  const updateContent = (rowIndex: number, contentIndex: number, values: Record<string, any>) => {
    const newRows = [...design.body.rows];
    newRows[rowIndex].cells[0].contents[contentIndex].values = {
      ...newRows[rowIndex].cells[0].contents[contentIndex].values,
      ...values,
    };

    const newDesign = {
      ...design,
      body: {
        ...design.body,
        rows: newRows,
      },
    };

    setDesign(newDesign);
    onChange(newDesign, '');
  };

  const deleteRow = (rowIndex: number) => {
    const newRows = design.body.rows.filter((_, i) => i !== rowIndex);
    const newDesign = {
      ...design,
      body: {
        ...design.body,
        rows: newRows,
      },
    };

    setDesign(newDesign);
    onChange(newDesign, '');
    setSelectedRowIndex(null);
  };

  const deleteContent = (rowIndex: number, contentIndex: number) => {
    const newRows = [...design.body.rows];
    newRows[rowIndex].cells[0].contents = newRows[rowIndex].cells[0].contents.filter(
      (_, i) => i !== contentIndex
    );

    const newDesign = {
      ...design,
      body: {
        ...design.body,
        rows: newRows,
      },
    };

    setDesign(newDesign);
    onChange(newDesign, '');
    setSelectedContentIndex(null);
  };

  const renderContent = (content: EmailTemplateContent) => {
    switch (content.type) {
      case 'text':
        return (
          <div
            style={{
              fontSize: content.values.fontSize,
              color: content.values.color,
              lineHeight: content.values.lineHeight,
            }}
          >
            {content.values.text}
          </div>
        );
      case 'image':
        return (
          <img
            src={content.values.src}
            alt={content.values.alt}
            style={{ width: content.values.width, maxWidth: '100%' }}
          />
        );
      case 'button':
        return (
          <div style={{ textAlign: 'center' }}>
            <a
              href={content.values.url}
              style={{
                display: 'inline-block',
                padding: content.values.padding,
                backgroundColor: content.values.backgroundColor,
                color: content.values.color,
                fontSize: content.values.fontSize,
                borderRadius: content.values.borderRadius,
                textDecoration: 'none',
              }}
            >
              {content.values.text}
            </a>
          </div>
        );
      case 'divider':
        return (
          <hr
            style={{
              border: 'none',
              borderTop: `${content.values.borderWidth} ${content.values.borderStyle} ${content.values.borderColor}`,
              margin: content.values.margin,
            }}
          />
        );
      case 'spacer':
        return <div style={{ height: content.values.height }}></div>;
      case 'html':
        return <div dangerouslySetInnerHTML={{ __html: content.values.html }} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Toolbar */}
      <div className="w-64 bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 mb-4">Элементы</h3>
        <div className="space-y-2">
          <button
            onClick={addRow}
            className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Добавить строку
          </button>
          {selectedRowIndex !== null && (
            <>
              <p className="text-xs text-gray-500 mt-4 mb-2">Добавить в строку:</p>
              <button
                onClick={() => addContent(selectedRowIndex, 'text')}
                className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Текст
              </button>
              <button
                onClick={() => addContent(selectedRowIndex, 'image')}
                className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Изображение
              </button>
              <button
                onClick={() => addContent(selectedRowIndex, 'button')}
                className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Кнопка
              </button>
              <button
                onClick={() => addContent(selectedRowIndex, 'divider')}
                className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Разделитель
              </button>
              <button
                onClick={() => addContent(selectedRowIndex, 'spacer')}
                className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Отступ
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 bg-gray-100 rounded-lg p-4 overflow-y-auto">
        <div
          style={{
            backgroundColor: design.body.values.backgroundColor,
            padding: '20px',
            minHeight: '400px',
          }}
        >
          <div
            style={{
              maxWidth: design.body.values.contentWidth,
              margin: '0 auto',
              backgroundColor: '#ffffff',
            }}
          >
            {design.body.rows.map((row, rowIndex) => (
              <div
                key={row.id}
                onClick={() => setSelectedRowIndex(rowIndex)}
                className={`cursor-pointer border-2 ${
                  selectedRowIndex === rowIndex ? 'border-blue-500' : 'border-transparent'
                }`}
                style={{
                  backgroundColor: row.values.backgroundColor,
                  padding: row.values.padding,
                }}
              >
                {row.cells[0].contents.map((content, contentIndex) => (
                  <div
                    key={content.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedContentIndex(contentIndex);
                    }}
                    className={`relative ${
                      selectedContentIndex === contentIndex ? 'ring-2 ring-green-500' : ''
                    }`}
                  >
                    {renderContent(content)}
                    {selectedContentIndex === contentIndex && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteContent(rowIndex, contentIndex);
                        }}
                        className="absolute top-0 right-0 bg-red-600 text-white px-2 py-1 text-xs rounded"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                ))}
                {selectedRowIndex === rowIndex && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRow(rowIndex);
                    }}
                    className="mt-2 px-2 py-1 bg-red-600 text-white text-xs rounded"
                  >
                    Удалить строку
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Properties Panel */}
      {selectedContentIndex !== null && selectedRowIndex !== null && (
        <div className="w-64 bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Свойства</h3>
          <div className="space-y-3">
            {Object.entries(
              design.body.rows[selectedRowIndex].cells[0].contents[selectedContentIndex].values
            ).map(([key, value]) => (
              <div key={key}>
                <label className="block text-xs text-gray-600 mb-1">{key}</label>
                <input
                  type="text"
                  value={String(value)}
                  onChange={(e) =>
                    updateContent(selectedRowIndex, selectedContentIndex, {
                      [key]: e.target.value,
                    })
                  }
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
