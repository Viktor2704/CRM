-- Knowledge Base with pgvector for RAG
-- Requires pgvector extension

-- Enable pgvector extension
create extension if not exists vector;

-- Knowledge base documents table
create table if not exists knowledge_base_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  file_name text not null default '',
  file_type text not null default 'txt',
  file_size integer not null default 0,
  storage_key text not null default '',
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_kb_documents_uploaded_by
  on knowledge_base_documents(uploaded_by_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_kb_documents_file_type
  on knowledge_base_documents(file_type)
  where deleted_at is null;

create index if not exists idx_kb_documents_search
  on knowledge_base_documents using gin(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')))
  where deleted_at is null;

-- Knowledge base chunks table with vector embeddings
create table if not exists knowledge_base_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_base_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null default '',
  token_count integer not null default 0,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create index if not exists idx_kb_chunks_document
  on knowledge_base_chunks(document_id, chunk_index);

-- Vector similarity search index using HNSW (Hierarchical Navigable Small World)
create index if not exists idx_kb_chunks_embedding_hnsw
  on knowledge_base_chunks using hnsw (embedding vector_cosine_ops);

-- Alternative: IVFFlat index (uncomment if HNSW is not available)
-- create index if not exists idx_kb_chunks_embedding_ivfflat
--   on knowledge_base_chunks using ivfflat (embedding vector_cosine_ops)
--   with (lists = 100);

-- Function to search similar chunks
create or replace function search_similar_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from knowledge_base_chunks c
  join knowledge_base_documents d on d.id = c.document_id
  where d.deleted_at is null
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
