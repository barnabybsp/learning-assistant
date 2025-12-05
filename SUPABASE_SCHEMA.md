# Supabase Schema Changes for Learning Paths and Study Chats

This document describes the database schema changes needed to support learning paths and study chats for each user.

## Required Tables

### 1. `learning_paths` Table

This table stores all learning paths created/selected by users.

```sql
CREATE TABLE learning_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  timeline TEXT,
  why_this_path TEXT,
  path_data JSONB NOT NULL, -- Stores the full learning path data including resources
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE learning_paths ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own learning paths
CREATE POLICY "Users can view their own learning paths"
  ON learning_paths FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own learning paths
CREATE POLICY "Users can insert their own learning paths"
  ON learning_paths FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own learning paths
CREATE POLICY "Users can update their own learning paths"
  ON learning_paths FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policy: Users can delete their own learning paths
CREATE POLICY "Users can delete their own learning paths"
  ON learning_paths FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX idx_learning_paths_user_id ON learning_paths(user_id);
CREATE INDEX idx_learning_paths_created_at ON learning_paths(created_at DESC);
```

### 2. `learning_path_resources` Table (Optional - for progress tracking)

This table stores individual resources within learning paths and tracks progress.

```sql
CREATE TABLE learning_path_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  order_number INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'book', 'youtube_video', 'podcast', 'online_course', 'other'
  title TEXT NOT NULL,
  author TEXT,
  channel TEXT,
  host TEXT,
  platform TEXT,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE learning_path_resources ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access resources from their own learning paths
CREATE POLICY "Users can view resources from their learning paths"
  ON learning_path_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM learning_paths
      WHERE learning_paths.id = learning_path_resources.learning_path_id
      AND learning_paths.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can insert resources into their learning paths
CREATE POLICY "Users can insert resources into their learning paths"
  ON learning_path_resources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM learning_paths
      WHERE learning_paths.id = learning_path_resources.learning_path_id
      AND learning_paths.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can update resources in their learning paths
CREATE POLICY "Users can update resources in their learning paths"
  ON learning_path_resources FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM learning_paths
      WHERE learning_paths.id = learning_path_resources.learning_path_id
      AND learning_paths.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_learning_path_resources_path_id ON learning_path_resources(learning_path_id);
CREATE INDEX idx_learning_path_resources_order ON learning_path_resources(learning_path_id, order_number);
```

### 3. `study_chat_conversations` Table

This table stores study chat conversations linked to specific learning paths.

```sql
CREATE TABLE study_chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE study_chat_conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own study chat conversations
CREATE POLICY "Users can view their own study chat conversations"
  ON study_chat_conversations FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own study chat conversations
CREATE POLICY "Users can insert their own study chat conversations"
  ON study_chat_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own study chat conversations
CREATE POLICY "Users can update their own study chat conversations"
  ON study_chat_conversations FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policy: Users can delete their own study chat conversations
CREATE POLICY "Users can delete their own study chat conversations"
  ON study_chat_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_study_chat_conversations_path_id ON study_chat_conversations(learning_path_id);
CREATE INDEX idx_study_chat_conversations_user_id ON study_chat_conversations(user_id);
CREATE INDEX idx_study_chat_conversations_updated_at ON study_chat_conversations(updated_at DESC);
```

### 4. `study_chat_messages` Table

This table stores individual messages within study chat conversations.

```sql
CREATE TABLE study_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES study_chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE study_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see messages from their own conversations
CREATE POLICY "Users can view messages from their conversations"
  ON study_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM study_chat_conversations
      WHERE study_chat_conversations.id = study_chat_messages.conversation_id
      AND study_chat_conversations.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can insert messages into their conversations
CREATE POLICY "Users can insert messages into their conversations"
  ON study_chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM study_chat_conversations
      WHERE study_chat_conversations.id = study_chat_messages.conversation_id
      AND study_chat_conversations.user_id = auth.uid()
    )
    AND auth.uid() = user_id
  );

-- Indexes
CREATE INDEX idx_study_chat_messages_conversation_id ON study_chat_messages(conversation_id);
CREATE INDEX idx_study_chat_messages_created_at ON study_chat_messages(conversation_id, created_at ASC);
```

## Functions and Triggers

### Update `updated_at` timestamp automatically

```sql
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for learning_paths
CREATE TRIGGER update_learning_paths_updated_at
  BEFORE UPDATE ON learning_paths
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for study_chat_conversations
CREATE TRIGGER update_study_chat_conversations_updated_at
  BEFORE UPDATE ON study_chat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

## Summary

You'll need to create these 4 new tables:
1. `learning_paths` - Stores user learning paths with full path data in JSONB format
2. `learning_path_resources` - Stores individual resources within paths (optional, for progress tracking like marking resources as complete)
3. `study_chat_conversations` - Stores study chat conversations linked to specific learning paths
4. `study_chat_messages` - Stores messages within study chat conversations

All tables have Row Level Security (RLS) enabled to ensure users can only access their own data.

## How to Apply These Changes in Supabase

1. **Go to your Supabase Dashboard**: Navigate to https://supabase.com/dashboard
2. **Select your project** (the learning-assistant project)
3. **Open SQL Editor**: Click on "SQL Editor" in the left sidebar
4. **Create a new query**: Click "New query"
5. **Copy and paste the SQL**: 
   - Copy all the SQL statements from this document in order
   - Start with table creation (`CREATE TABLE` statements)
   - Then add RLS policies (`CREATE POLICY` statements)
   - Then add indexes (`CREATE INDEX` statements)
   - Finally add triggers (`CREATE TRIGGER` statements)
6. **Run the query**: Click "Run" or press Cmd/Ctrl + Enter
7. **Verify**: Go to "Table Editor" in the left sidebar and confirm all 4 tables are created:
   - `learning_paths`
   - `learning_path_resources` (optional)
   - `study_chat_conversations`
   - `study_chat_messages`

## Important Notes

- The `path_data` column in `learning_paths` uses JSONB to store the complete learning path structure (title, description, resources, etc.)
- Each study chat conversation is linked to a specific learning path via `learning_path_id`
- When a learning path is deleted, related study chats are automatically deleted (CASCADE)
- All RLS policies ensure users can only access their own data using `auth.uid()`
- The `learning_path_resources` table is optional - you can track progress there or just store everything in the JSONB `path_data` field

