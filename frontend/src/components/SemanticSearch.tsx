import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { api } from '@/api/client';

type SearchResult = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
};

type SemanticSearchProps = {
  onResultsFound?: (results: SearchResult[]) => void;
  placeholder?: string;
  className?: string;
};

export default function SemanticSearch({ onResultsFound, placeholder, className }: SemanticSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) {
      setError('Введите поисковый запрос');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.post<{ results: SearchResult[] }>('/knowledge-base/search', {
        query: query.trim(),
        matchThreshold: 0.7,
        matchCount: 5,
      });

      const searchResults = response?.results || [];
      setResults(searchResults);

      if (onResultsFound) {
        onResultsFound(searchResults);
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка поиска');
    } finally {
      setLoading(false);
    }
  };

  const highlightText = (text: string, searchQuery: string) => {
    if (!searchQuery) return text;
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 px-1">{part}</mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className={className}>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder || 'Поиск по базе знаний...'}
          disabled={loading}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Поиск...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Найти
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm mb-4">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-700">
            Найдено результатов: {results.length}
          </div>
          {results.map((result) => (
            <div
              key={result.chunkId}
              className="p-4 bg-white border border-gray-200 rounded-md hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-medium text-blue-600 text-sm">
                  {result.documentTitle}
                </div>
                <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  {(result.similarity * 100).toFixed(0)}%
                </div>
              </div>
              <div className="text-sm text-gray-700 leading-relaxed">
                {highlightText(result.content, query)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && query && !error && (
        <div className="p-6 text-center text-gray-500 bg-gray-50 rounded-md">
          Ничего не найдено. Попробуйте изменить запрос.
        </div>
      )}
    </div>
  );
}
