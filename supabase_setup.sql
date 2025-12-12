-- =====================================================
-- Supabase Schema Setup for Learning Paths and Study Chats
-- =====================================================
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- =====================================================
-- 1. LEARNING PATHS TABLE
-- =====================================================
CREATE TABLE learning_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  timeline TEXT,
  why_this_path TEXT,
  path_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE learning_paths ENABLE ROW LEVEL SECURITY;

-- RLS Policies for learning_paths
CREATE POLICY "Users can view their own learning paths"
  ON learning_paths FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own learning paths"
  ON learning_paths FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own learning paths"
  ON learning_paths FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own learning paths"
  ON learning_paths FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for learning_paths
CREATE INDEX idx_learning_paths_user_id ON learning_paths(user_id);
CREATE INDEX idx_learning_paths_created_at ON learning_paths(created_at DESC);

-- =====================================================
-- 2. LEARNING PATH RESOURCES TABLE (Optional - for progress tracking)
-- =====================================================
CREATE TABLE learning_path_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  order_number INTEGER NOT NULL,
  type TEXT NOT NULL,
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

-- RLS Policies for learning_path_resources
CREATE POLICY "Users can view resources from their learning paths"
  ON learning_path_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM learning_paths
      WHERE learning_paths.id = learning_path_resources.learning_path_id
      AND learning_paths.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert resources into their learning paths"
  ON learning_path_resources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM learning_paths
      WHERE learning_paths.id = learning_path_resources.learning_path_id
      AND learning_paths.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update resources in their learning paths"
  ON learning_path_resources FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM learning_paths
      WHERE learning_paths.id = learning_path_resources.learning_path_id
      AND learning_paths.user_id = auth.uid()
    )
  );

-- Indexes for learning_path_resources
CREATE INDEX idx_learning_path_resources_path_id ON learning_path_resources(learning_path_id);
CREATE INDEX idx_learning_path_resources_order ON learning_path_resources(learning_path_id, order_number);

-- =====================================================
-- 3. STUDY CHAT CONVERSATIONS TABLE
-- =====================================================
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

-- RLS Policies for study_chat_conversations
CREATE POLICY "Users can view their own study chat conversations"
  ON study_chat_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own study chat conversations"
  ON study_chat_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own study chat conversations"
  ON study_chat_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own study chat conversations"
  ON study_chat_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for study_chat_conversations
CREATE INDEX idx_study_chat_conversations_path_id ON study_chat_conversations(learning_path_id);
CREATE INDEX idx_study_chat_conversations_user_id ON study_chat_conversations(user_id);
CREATE INDEX idx_study_chat_conversations_updated_at ON study_chat_conversations(updated_at DESC);

-- =====================================================
-- 4. STUDY CHAT MESSAGES TABLE
-- =====================================================
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

-- RLS Policies for study_chat_messages
CREATE POLICY "Users can view messages from their conversations"
  ON study_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM study_chat_conversations
      WHERE study_chat_conversations.id = study_chat_messages.conversation_id
      AND study_chat_conversations.user_id = auth.uid()
    )
  );

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

-- Indexes for study_chat_messages
CREATE INDEX idx_study_chat_messages_conversation_id ON study_chat_messages(conversation_id);
CREATE INDEX idx_study_chat_messages_created_at ON study_chat_messages(conversation_id, created_at ASC);

-- =====================================================
-- 5. FUNCTION AND TRIGGERS FOR AUTO-UPDATING updated_at
-- =====================================================

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

-- =====================================================
-- DONE! All tables, policies, indexes, and triggers created.
-- =====================================================

