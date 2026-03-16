import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Minimize2, Maximize2, HelpCircle } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useLocation } from 'react-router-dom';
import { api } from '@/api/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestions?: string[];
  relatedLinks?: Array<{ title: string; url: string }>;
}

interface AIChatAssistantProps {
  initiallyOpen?: boolean;
}

export default function AIChatAssistant({ initiallyOpen = false }: AIChatAssistantProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showContextualHelp, setShowContextualHelp] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { user: _user } = useAuth();
  const location = useLocation();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load contextual help when page changes
  useEffect(() => {
    if (isOpen && showContextualHelp && messages.length === 0) {
      loadContextualHelp();
    }
  }, [location.pathname, isOpen]);

  const loadContextualHelp = async () => {
    try {
      const page = location.pathname.split('/')[1] || 'dashboard';
      const data = await api.post('/ai/chatbot/contextual-help', { page }) as any;
      if (data?.message) {
        setMessages([
          {
            role: 'assistant',
            content: data.message,
            timestamp: new Date(),
            suggestions: data.suggestions,
            relatedLinks: data.relatedLinks,
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to load contextual help:', error);
    }
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const page = location.pathname.split('/')[1] || 'dashboard';
      const data = await api.post('/ai/chatbot/chat', {
        message: inputValue,
        context: {
          currentPage: page,
        },
        conversationHistory: messages.slice(-5).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }) as any;

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.message,
        timestamp: new Date(),
        suggestions: data.suggestions,
        relatedLinks: data.relatedLinks,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setShowContextualHelp(true);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition-all duration-200 hover:scale-110"
        title="Open AI Assistant"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 bg-white rounded-lg shadow-2xl border border-slate-200 transition-all duration-200 ${
        isMinimized ? 'w-80 h-16' : 'w-96 h-[600px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          <h3 className="font-semibold">AI Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="hover:bg-blue-800 rounded p-1 transition-colors"
            title={isMinimized ? 'Maximize' : 'Minimize'}
          >
            {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="hover:bg-blue-800 rounded p-1 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 h-[calc(600px-140px)]">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 py-8">
                <HelpCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">Ask me anything about the system!</p>
                <p className="text-xs mt-2">I can help you navigate, answer questions, and provide guidance.</p>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-800 border border-slate-200'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                  {message.suggestions && message.suggestions.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-semibold text-slate-600">Suggestions:</p>
                      {message.suggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSuggestionClick(suggestion)}
                          className="block w-full text-left text-xs bg-white hover:bg-slate-50 border border-slate-200 rounded px-2 py-1 transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}

                  {message.relatedLinks && message.relatedLinks.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-semibold text-slate-600">Related:</p>
                      {message.relatedLinks.map((link, idx) => (
                        <a
                          key={idx}
                          href={link.url}
                          className="block text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          → {link.title}
                        </a>
                      ))}
                    </div>
                  )}

                  <p className="text-xs opacity-60 mt-2">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-lg p-3 border border-slate-200">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 p-4">
            <div className="flex gap-2">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me anything..."
                className="flex-1 resize-none border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={2}
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || isLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg px-4 transition-colors"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs text-slate-500 hover:text-slate-700 mt-2 transition-colors"
              >
                Clear chat
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
