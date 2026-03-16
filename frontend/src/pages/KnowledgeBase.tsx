import { useState, useEffect } from 'react';
import { Upload, Search, FileText, Trash2, BookOpen } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import Breadcrumbs from '@/components/Breadcrumbs';

type Document = {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedById: string | null;
  createdAt: string;
  updatedAt: string;
};

type SearchResult = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
};

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentTitle, setDocumentTitle] = useState('');
  const [viewMode, setViewMode] = useState<'documents' | 'search'>('documents');
  const { showToast } = useToast();

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const response = await api.get('/knowledge-base/documents') as any;
      setDocuments(response.documents || []);
    } catch (error) {
      showToast('Ошибка загрузки документов', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'text/plain', 'text/markdown', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Поддерживаются только PDF, TXT, MD, DOC, DOCX файлы', 'error');
      return;
    }

    setSelectedFile(file);
    setDocumentTitle(file.name.replace(/\.[^/.]+$/, ''));
  };

  const handleUpload = async () => {
    if (!selectedFile || !documentTitle.trim()) {
      showToast('Выберите файл и укажите название', 'error');
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;

        const fileTypeMap: Record<string, string> = {
          'application/pdf': 'pdf',
          'text/plain': 'txt',
          'text/markdown': 'md',
          'application/msword': 'doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        };

        const fileType = fileTypeMap[selectedFile.type] || 'txt';

        await api.post('/knowledge-base/documents', {
          title: documentTitle.trim(),
          fileName: selectedFile.name,
          fileType,
          dataUrl,
        });

        showToast('Документ успешно загружен и обработан', 'success');
        setSelectedFile(null);
        setDocumentTitle('');
        loadDocuments();
      };
      reader.readAsDataURL(selectedFile);
    } catch (error: any) {
      showToast(error.message || 'Ошибка загрузки документа', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      showToast('Введите поисковый запрос', 'error');
      return;
    }

    setSearching(true);
    try {
      const response = await api.post('/knowledge-base/search', {
        query: searchQuery.trim(),
        matchThreshold: 0.7,
        matchCount: 5,
      }) as any;

      setSearchResults(response.results || []);
      setViewMode('search');
    } catch (error: any) {
      showToast(error.message || 'Ошибка поиска', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить документ?')) return;

    try {
      await api.delete(`/knowledge-base/documents/${id}`);
      showToast('Документ удален', 'success');
      loadDocuments();
    } catch (error: any) {
      showToast(error.message || 'Ошибка удаления', 'error');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200">{part}</mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="p-6">
      <Breadcrumbs items={[{ label: 'База знаний' }]} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          База знаний
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('documents')}
            className={`px-4 py-2 rounded ${viewMode === 'documents' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
          >
            <FileText className="w-4 h-4 inline mr-2" />
            Документы
          </button>
          <button
            onClick={() => setViewMode('search')}
            className={`px-4 py-2 rounded ${viewMode === 'search' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
          >
            <Search className="w-4 h-4 inline mr-2" />
            Поиск
          </button>
        </div>
      </div>

      {viewMode === 'documents' && (
        <>
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Загрузить документ</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Название документа</label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="Введите название"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Файл (PDF, TXT, MD, DOC, DOCX)</label>
                <input
                  type="file"
                  onChange={handleFileSelect}
                  accept=".pdf,.txt,.md,.doc,.docx"
                  className="w-full"
                />
                {selectedFile && (
                  <p className="text-sm text-gray-600 mt-2">
                    Выбран: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </p>
                )}
              </div>
              <button
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !documentTitle.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4 inline mr-2" />
                {uploading ? 'Загрузка...' : 'Загрузить'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold">Документы ({documents.length})</h2>
            </div>
            <div className="divide-y">
              {loading ? (
                <div className="p-6 text-center text-gray-500">Загрузка...</div>
              ) : documents.length === 0 ? (
                <div className="p-6 text-center text-gray-500">Нет документов</div>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="p-4 hover:bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <div>
                        <div className="font-medium">{doc.title}</div>
                        <div className="text-sm text-gray-500">
                          {doc.fileName} • {formatFileSize(doc.fileSize)} • {new Date(doc.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded"
                        title="Удалить"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {viewMode === 'search' && (
        <>
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Семантический поиск</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-3 py-2 border rounded"
                placeholder="Введите запрос для поиска по смыслу..."
              />
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                <Search className="w-4 h-4 inline mr-2" />
                {searching ? 'Поиск...' : 'Найти'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold">Результаты поиска ({searchResults.length})</h2>
            </div>
            <div className="divide-y">
              {searchResults.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  {searchQuery ? 'Ничего не найдено' : 'Введите запрос для поиска'}
                </div>
              ) : (
                searchResults.map((result) => (
                  <div key={result.chunkId} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium text-blue-600">{result.documentTitle}</div>
                      <div className="text-sm text-gray-500">
                        Релевантность: {(result.similarity * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-sm text-gray-700 line-clamp-3">
                      {highlightText(result.content, searchQuery)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
