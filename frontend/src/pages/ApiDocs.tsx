import { useState } from 'react';
import { Book, Code, Terminal, ExternalLink, Copy, Check } from 'lucide-react';

interface EndpointExample {
  method: string;
  path: string;
  description: string;
  auth: boolean;
  requestBody?: any;
  responseExample?: any;
}

const ApiDocs: React.FC = () => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'endpoints' | 'examples'>('overview');

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const endpoints: EndpointExample[] = [
    {
      method: 'POST',
      path: '/auth/login',
      description: 'Аутентификация пользователя по email и паролю',
      auth: false,
      requestBody: {
        email: 'user@example.com',
        password: 'password123'
      },
      responseExample: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'user@example.com',
          fullName: 'John Doe',
          role: 'manager'
        }
      }
    },
    {
      method: 'GET',
      path: '/projects',
      description: 'Список всех проектов с пагинацией и фильтрацией',
      auth: true,
      responseExample: {
        projects: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Office Ventilation System',
            status: 'in_progress',
            priority: 'high'
          }
        ],
        meta: {
          total: 100,
          page: 1,
          limit: 20,
          totalPages: 5
        }
      }
    },
    {
      method: 'POST',
      path: '/service-requests',
      description: 'Создание новой заявки на обслуживание',
      auth: true,
      requestBody: {
        title: 'Emergency repair needed',
        description: 'Water leak in building A',
        type: 'emergency',
        priority: 'critical',
        systemType: 'plumbing'
      },
      responseExample: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Emergency repair needed',
        status: 'new',
        createdAt: '2026-03-12T10:00:00Z'
      }
    },
    {
      method: 'GET',
      path: '/notifications',
      description: 'Получение уведомлений пользователя',
      auth: true,
      responseExample: {
        notifications: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            type: 'project_status_changed',
            title: 'Project status updated',
            message: 'Project moved to review stage',
            read: false,
            createdAt: '2026-03-12T10:00:00Z'
          }
        ]
      }
    }
  ];

  const codeExamples = {
    javascript: `// JavaScript/Node.js Example
const API_BASE_URL = '${apiBaseUrl}/api/v1';

// Login
async function login(email, password) {
  const response = await fetch(\`\${API_BASE_URL}/auth/login\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  return data.accessToken;
}

// Fetch projects with authentication
async function getProjects(accessToken) {
  const response = await fetch(\`\${API_BASE_URL}/projects\`, {
    headers: {
      'Authorization': \`Bearer \${accessToken}\`,
    },
    credentials: 'include',
  });

  return await response.json();
}

// Create service request
async function createServiceRequest(accessToken, data) {
  const response = await fetch(\`\${API_BASE_URL}/service-requests\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${accessToken}\`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  return await response.json();
}`,
    python: `# Python Example
import requests

API_BASE_URL = '${apiBaseUrl}/api/v1'

# Login
def login(email, password):
    response = requests.post(
        f'{API_BASE_URL}/auth/login',
        json={'email': email, 'password': password}
    )
    data = response.json()
    return data['accessToken']

# Fetch projects
def get_projects(access_token):
    response = requests.get(
        f'{API_BASE_URL}/projects',
        headers={'Authorization': f'Bearer {access_token}'}
    )
    return response.json()

# Create service request
def create_service_request(access_token, data):
    response = requests.post(
        f'{API_BASE_URL}/service-requests',
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        },
        json=data
    )
    return response.json()`,
    curl: `# cURL Examples

# Login
curl -X POST ${apiBaseUrl}/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"password123"}' \\
  -c cookies.txt

# Get projects (using saved cookies)
curl -X GET ${apiBaseUrl}/api/v1/projects \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -b cookies.txt

# Create service request
curl -X POST ${apiBaseUrl}/api/v1/service-requests \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Emergency repair",
    "type": "emergency",
    "priority": "critical"
  }' \\
  -b cookies.txt`
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Book className="w-8 h-8 text-blue-600" />
                API Документация
              </h1>
              <p className="mt-2 text-gray-600">
                Полный справочник API системы управления проектами Новинжстрой
              </p>
            </div>
            <div className="flex gap-3">
              <a
                href="/api-docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Интерактивный API
              </a>
              <a
                href="/api-docs.json"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Code className="w-4 h-4" />
                OpenAPI спецификация
              </a>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'overview'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Обзор
              </button>
              <button
                onClick={() => setActiveTab('endpoints')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'endpoints'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Эндпоинты
              </button>
              <button
                onClick={() => setActiveTab('examples')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'examples'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Примеры кода
              </button>
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <section>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Начало работы</h2>
                  <div className="prose max-w-none">
                    <p className="text-gray-600 mb-4">
                      API Новинжстрой — это RESTful API для программного взаимодействия с системой управления проектами.
                      Все эндпоинты версионированы и используют JSON для тел запросов и ответов.
                    </p>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                      <p className="text-sm text-blue-800">
                        <strong>Базовый URL:</strong> <code className="bg-blue-100 px-2 py-1 rounded">{apiBaseUrl}/api/v1</code>
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Аутентификация</h3>
                  <p className="text-gray-600 mb-4">
                    API использует аутентификацию на основе JWT (JSON Web Token). Для аутентификации:
                  </p>
                  <ol className="list-decimal list-inside space-y-2 text-gray-600 mb-4">
                    <li>Отправьте POST-запрос на <code className="bg-gray-100 px-2 py-1 rounded">/auth/login</code> с email и паролем</li>
                    <li>Получите access token (действителен 15 минут) и refresh token cookie (HTTP-only)</li>
                    <li>Передавайте access token в заголовке Authorization: <code className="bg-gray-100 px-2 py-1 rounded">Bearer YOUR_TOKEN</code></li>
                    <li>Используйте <code className="bg-gray-100 px-2 py-1 rounded">/auth/refresh</code> для обновления access token по истечении срока</li>
                  </ol>
                </section>

                <section>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Ограничение запросов</h3>
                  <p className="text-gray-600 mb-4">
                    API-запросы ограничены для предотвращения злоупотреблений:
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-gray-600">
                    <li>Эндпоинты аутентификации: 30 запросов за 15 минут</li>
                    <li>Общие API-эндпоинты: 60 запросов за 15 минут</li>
                    <li>AI-эндпоинты: 30 запросов в минуту</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Формат ответа</h3>
                  <p className="text-gray-600 mb-4">
                    Все ответы в формате JSON. Успешные ответы возвращают запрошенные данные с соответствующими HTTP-кодами.
                    Ответы с ошибками имеют следующий формат:
                  </p>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
{`{
  "error": "VALIDATION_ERROR",
  "message": "Invalid input data",
  "details": {}
}`}
                  </pre>
                </section>

                <section>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Версионирование API</h3>
                  <p className="text-gray-600 mb-4">
                    API версионируется через путь URL (например, <code className="bg-gray-100 px-2 py-1 rounded">/api/v1/</code>).
                    Информация о версии включена в заголовки ответа:
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-gray-600">
                    <li><code className="bg-gray-100 px-2 py-1 rounded">X-API-Version</code>: Текущая версия API</li>
                    <li><code className="bg-gray-100 px-2 py-1 rounded">X-API-Deprecated</code>: "true" при использовании устаревшей версии</li>
                    <li><code className="bg-gray-100 px-2 py-1 rounded">X-API-Sunset-Date</code>: Дата удаления устаревшей версии</li>
                  </ul>
                </section>
              </div>
            )}

            {/* Endpoints Tab */}
            {activeTab === 'endpoints' && (
              <div className="space-y-6">
                <div className="mb-4">
                  <p className="text-gray-600">
                    Для полной интерактивной документации со схемами запросов/ответов перейдите в{' '}
                    <a href="/api-docs" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Swagger UI
                    </a>.
                  </p>
                </div>

                {endpoints.map((endpoint, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-3 py-1 rounded text-sm font-semibold ${
                            endpoint.method === 'GET'
                              ? 'bg-green-100 text-green-800'
                              : endpoint.method === 'POST'
                              ? 'bg-blue-100 text-blue-800'
                              : endpoint.method === 'PATCH'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {endpoint.method}
                        </span>
                        <code className="text-sm font-mono text-gray-900">{endpoint.path}</code>
                      </div>
                      {endpoint.auth && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">
                          Требуется авторизация
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 mb-3">{endpoint.description}</p>

                    {endpoint.requestBody && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700">Тело запроса:</h4>
                          <button
                            onClick={() => copyToClipboard(JSON.stringify(endpoint.requestBody, null, 2), `req-${index}`)}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            {copiedCode === `req-${index}` ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-sm overflow-x-auto">
                          {JSON.stringify(endpoint.requestBody, null, 2)}
                        </pre>
                      </div>
                    )}

                    {endpoint.responseExample && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700">Пример ответа:</h4>
                          <button
                            onClick={() => copyToClipboard(JSON.stringify(endpoint.responseExample, null, 2), `res-${index}`)}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            {copiedCode === `res-${index}` ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-sm overflow-x-auto">
                          {JSON.stringify(endpoint.responseExample, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Code Examples Tab */}
            {activeTab === 'examples' && (
              <div className="space-y-6">
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      <Terminal className="w-5 h-5" />
                      JavaScript / Node.js
                    </h3>
                    <button
                      onClick={() => copyToClipboard(codeExamples.javascript, 'js')}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      {copiedCode === 'js' ? (
                        <Check className="w-5 h-5 text-green-600" />
                      ) : (
                        <Copy className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                    {codeExamples.javascript}
                  </pre>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      <Terminal className="w-5 h-5" />
                      Python
                    </h3>
                    <button
                      onClick={() => copyToClipboard(codeExamples.python, 'py')}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      {copiedCode === 'py' ? (
                        <Check className="w-5 h-5 text-green-600" />
                      ) : (
                        <Copy className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                    {codeExamples.python}
                  </pre>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      <Terminal className="w-5 h-5" />
                      cURL
                    </h3>
                    <button
                      onClick={() => copyToClipboard(codeExamples.curl, 'curl')}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      {copiedCode === 'curl' ? (
                        <Check className="w-5 h-5 text-green-600" />
                      ) : (
                        <Copy className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                    {codeExamples.curl}
                  </pre>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiDocs;
