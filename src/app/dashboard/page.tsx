"use client"; // This tells Next.js this is a client component (uses React hooks and browser APIs)

import { useEffect, useState, useRef, useCallback } from "react"; // React hooks for side effects and state
import { supabase } from "@/lib/supabaseClient"; // Our Supabase client for database/auth
import { useRouter } from "next/navigation"; // Next.js hook for navigation/redirects
import type { User } from "@supabase/supabase-js"; // TypeScript type for a user object

// Type definitions for learning paths
type LearningPathResource = {
  order: number;
  type: "book" | "youtube_video" | "podcast" | "online_course" | "other";
  title: string;
  url: string;
  author?: string;
  channel?: string;
  host?: string;
  platform?: string;
  price?: string;
};

type LearningPath = {
  title: string;
  description: string;
  timeline: string;
  why_this_path: string;
  resources: LearningPathResource[];
  rawText?: string; // Store the original English text for display
  id?: string; // Database ID for saved paths
};

// Function to parse English text learning paths (same as server-side)
function parseEnglishLearningPaths(text: string): LearningPath[] | null {
  try {
    const paths: LearningPath[] = [];
    
    // Split by path markers (PATH 1:, PATH 2:, PATH 3:)
    const pathSections = text.split(/\*\*PATH\s+\d+:/i);
    
    // Skip the first empty element before PATH 1
    for (let i = 1; i < pathSections.length && paths.length < 3; i++) {
      const section = pathSections[i].trim();
      
      // Extract title (first line after PATH X:)
      const titleMatch = section.match(/^([^\n]+)/);
      if (!titleMatch) continue;
      
      const title = titleMatch[1].trim();
      
      // Extract description (text before Timeline)
      const descriptionMatch = section.match(/\n\n([\s\S]*?)\n\nTimeline:/);
      const description = descriptionMatch ? descriptionMatch[1].trim() : "";
      
      // Extract timeline
      const timelineMatch = section.match(/Timeline:\s*([^\n]+)/i);
      const timeline = timelineMatch ? timelineMatch[1].trim() : "";
      
      // Extract why this path
      const whyMatch = section.match(/Why this path:\s*([^\n]+)/i);
      const why_this_path = whyMatch ? whyMatch[1].trim() : "";
      
      // Extract resources
      const resources: LearningPathResource[] = [];
      const resourcesSection = section.match(/Resources\s*\(in order\):([\s\S]*?)(?=\n\n\*\*PATH|\n*$)/i);
      
      if (resourcesSection) {
        const resourceLines = resourcesSection[1].split(/\n/).filter(line => line.trim().match(/^\d+\./));
        
        resourceLines.forEach((line, index) => {
          const order = index + 1;
          // Match resource line without requiring URL
          const match = line.match(/^\d+\.\s*(.+)/);
          
          if (match) {
            const resourceText = match[1].trim();
            
            // Determine resource type
            let type: "book" | "youtube_video" | "podcast" | "online_course" | "other" = "other";
            const lowerText = resourceText.toLowerCase();
            if (lowerText.includes("book") || resourceText.match(/by\s+[A-Z]/)) {
              type = "book";
            } else if (lowerText.includes("youtube") || lowerText.includes("video")) {
              type = "youtube_video";
            } else if (lowerText.includes("podcast")) {
              type = "podcast";
            } else if (lowerText.includes("course")) {
              type = "online_course";
            }
            
            // Extract title and author/channel
            let title = resourceText;
            let author: string | undefined = undefined;
            
            // Pattern 1: "Book: Title by Author"
            const typeColonMatch = resourceText.match(/^[^:]+:\s*(.+?)\s+by\s+(.+)/i);
            if (typeColonMatch) {
              title = typeColonMatch[1].trim();
              author = typeColonMatch[2].trim();
            } else {
              // Pattern 2: "Title by Author"
              const byMatch = resourceText.match(/(.+?)\s+by\s+(.+)/i);
              if (byMatch) {
                title = byMatch[1].trim();
                author = byMatch[2].trim();
              }
            }
            
            resources.push({
              order,
              type,
              title: title || resourceText,
              url: "", // No URLs anymore
              author,
            });
          }
        });
      }
      
      paths.push({
        title,
        description,
        timeline,
        why_this_path,
        resources,
      });
    }
    
    return paths.length >= 1 ? paths : null;
  } catch (error) {
    console.error("Error parsing English learning paths:", error);
    return null;
  }
}

// Function to extract the raw text for a specific path
function extractPathText(fullText: string, pathNumber: number): string {
  try {
    if (!fullText || typeof fullText !== "string") {
      return "";
    }
    
    const pathSections = fullText.split(/\*\*PATH\s+\d+:/i);
    // pathNumber is 1-indexed, so we need to check pathNumber <= pathSections.length
    // pathSections[0] is text before PATH 1, pathSections[1] is PATH 1, etc.
    if (pathNumber > 0 && pathNumber < pathSections.length) {
      const section = pathSections[pathNumber].trim();
      // Get text until next PATH or end
      const match = section.match(/([\s\S]*?)(?=\n\n\*\*PATH|\n*$)/);
      return match ? match[1].trim() : section;
    }
    return "";
  } catch (error) {
    console.error("Error extracting path text:", error);
    return "";
  }
}

// Type definitions for conversations and messages
type Conversation = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
};

export default function DashboardPage() {
  // State to store the current logged-in user (or null if not logged in)
  const [user, setUser] = useState<User | null>(null);
  
  // State to track if we're still checking auth status
  const [loading, setLoading] = useState(true);
  
  // State for conversations list
  const [conversations, setConversations] = useState<Conversation[]>([]);
  
  // State for current conversation ID
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  
  // State for messages in current conversation
  const [messages, setMessages] = useState<Message[]>([]);
  
  // State for the book recommendation prompt input
  const [prompt, setPrompt] = useState("");
  
  // Context menu for conversation actions
  const [contextMenu, setContextMenu] = useState<{
    conversationId: string;
    x: number;
    y: number;
  } | null>(null);
  
  // State to track if we're waiting for AI response
  const [aiLoading, setAiLoading] = useState(false);
  
  // State to store any error messages
  const [error, setError] = useState<string | null>(null);
  
  // State for learning paths
  const [learningPaths, setLearningPaths] = useState<LearningPath[] | null>(null);
  
  // State for selected learning path
  const [selectedPath, setSelectedPath] = useState<LearningPath | null>(null);

  // State for active tab/section
  const [activeTab, setActiveTab] = useState<"generate" | "paths">("generate");

  // State for saved/active learning paths (for tracking progress)
  const [savedLearningPaths, setSavedLearningPaths] = useState<LearningPath[]>([]);
  
  // State for study chat within a learning path
  const [showStudyChat, setShowStudyChat] = useState(false);
  const [studyChatMessages, setStudyChatMessages] = useState<Message[]>([]);
  const [studyChatPrompt, setStudyChatPrompt] = useState("");
  const [studyChatLoading, setStudyChatLoading] = useState(false);
  const [studyChatConversationId, setStudyChatConversationId] = useState<string | null>(null);
  const [selectedLearningPathId, setSelectedLearningPathId] = useState<string | null>(null);

  // State for editing learning paths
  const [editingPath, setEditingPath] = useState<LearningPath | null>(null);
  const [editingPathIndex, setEditingPathIndex] = useState<number | null>(null);

  // Ref for auto-scrolling to latest message
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Next.js router for programmatic navigation (redirects)
  const router = useRouter();

  // Load user's conversations from database
  const loadConversations = useCallback(async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error loading conversations:", error);
    } else {
      setConversations(data || []);
    }
  }, [user]);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error loading messages:", error);
    } else {
      // Filter out system messages from display
      let filteredMessages = (data || []).filter((msg) => msg.role !== "system");
      
      // Check all assistant messages for learning paths (JSON or English text) and filter them out from chat
      filteredMessages = filteredMessages.filter((msg) => {
        if (msg.role === "assistant") {
          // Check for English text learning paths
          const pathPattern = /\*\*PATH\s+\d+:/i;
          if (pathPattern.test(msg.content)) {
            // This is a learning paths response, don't show it as a message
            return false;
          }
          
          // Check for JSON learning paths
          try {
            const parsed = JSON.parse(msg.content);
            if (parsed.learning_paths && Array.isArray(parsed.learning_paths)) {
              // This is a learning paths JSON, don't show it as a message
              return false;
            }
          } catch {
            // Not JSON, show it as a regular message
          }
        }
        return true;
      });
      
      setMessages(filteredMessages);
      
      // Check if any assistant message contains learning paths (JSON or English text)
      const allMessages = (data || []).filter((msg) => msg.role !== "system");
      for (const msg of allMessages.reverse()) {
        if (msg.role === "assistant" && msg.content) {
          try {
            // Check for English text learning paths
            const pathPattern = /\*\*PATH\s+\d+:/i;
            if (pathPattern.test(msg.content)) {
              // Parse English text learning paths
              const paths = parseEnglishLearningPaths(msg.content);
              if (paths && paths.length >= 1) {
                // Store raw text with each path for display
                const pathsWithText = paths.map((path, index) => {
                  try {
                    return {
                      ...path,
                      rawText: extractPathText(msg.content, index + 1),
                    };
                  } catch (extractError) {
                    console.error(`Error extracting text for path ${index + 1} from loaded message:`, extractError);
                    return path;
                  }
                });
                setLearningPaths(pathsWithText);
                break;
              }
            }
            
            // Also check for JSON format (backward compatibility)
            try {
              const parsed = JSON.parse(msg.content);
              if (parsed.learning_paths && Array.isArray(parsed.learning_paths) && parsed.learning_paths.length > 0) {
                // Validate and normalize learning paths structure
                const validPaths = parsed.learning_paths.map((path: Partial<LearningPath>) => ({
                  ...path,
                  resources: Array.isArray(path.resources) ? path.resources : [],
                })) as LearningPath[];
                setLearningPaths(validPaths);
                break; // Found learning paths, stop looking
              }
            } catch {
              // Not JSON, continue checking
            }
          } catch (error) {
            console.error("Error processing message for learning paths:", error);
            // Continue checking other messages
          }
        }
      }
    }
  }, []);

  // Load saved learning paths from database
  const loadSavedLearningPaths = useCallback(async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("learning_paths")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading learning paths:", error);
    } else {
      // Parse the JSONB path_data to reconstruct LearningPath objects
      const paths: LearningPath[] = (data || []).map((path: any) => {
        const pathData = path.path_data || {};
        return {
          title: path.title || pathData.title || "Untitled Path",
          description: path.description || pathData.description || "",
          timeline: path.timeline || pathData.timeline || "",
          why_this_path: path.why_this_path || pathData.why_this_path || "",
          resources: pathData.resources || [],
          rawText: pathData.rawText,
          id: path.id, // Store the database ID for reference
        };
      });
      setSavedLearningPaths(paths);
    }
  }, [user]);

  // Save a learning path to database
  const saveLearningPath = useCallback(async (path: LearningPath): Promise<string | null> => {
    if (!user) {
      console.error("Cannot save learning path: user not logged in");
      return null;
    }

    // Check if path already exists (by title)
    const existingPath = savedLearningPaths.find((p) => p.title === path.title && p.id);
    
    if (existingPath?.id) {
      // Path already exists, return existing ID
      return existingPath.id;
    }

    try {
      // Prepare path_data JSONB with all path information
      const pathData = {
        title: path.title,
        description: path.description,
        timeline: path.timeline,
        why_this_path: path.why_this_path,
        resources: path.resources || [],
        rawText: path.rawText,
      };

      const { data, error } = await supabase
        .from("learning_paths")
        .insert({
          user_id: user.id,
          title: path.title,
          description: path.description,
          timeline: path.timeline,
          why_this_path: path.why_this_path,
          path_data: pathData,
        })
        .select("id")
        .single();

      if (error) {
        console.error("Error saving learning path:", error);
        return null;
      }

      // Reload saved learning paths to include the new one
      await loadSavedLearningPaths();
      
      return data.id;
    } catch (err) {
      console.error("Unexpected error saving learning path:", err);
      return null;
    }
  }, [user, savedLearningPaths, loadSavedLearningPaths]);

  // Load conversations when user is available
  useEffect(() => {
    if (user) {
      loadConversations();
      loadSavedLearningPaths();
    }
  }, [user, loadConversations, loadSavedLearningPaths]);

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId);
    } else {
      setMessages([]);
    }
  }, [currentConversationId, loadMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close context menu on global click or escape
  useEffect(() => {
    function handleGlobalClick() {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Start a new conversation/project
  function startNewConversation() {
    setCurrentConversationId(null);
    setMessages([]);
    setPrompt("");
    setError(null);
    setContextMenu(null);
    setLearningPaths(null);
    setSelectedPath(null);
    setShowStudyChat(false);
  }

  // Select an existing conversation
  function selectConversation(conversationId: string) {
    setCurrentConversationId(conversationId);
    setPrompt("");
    setError(null);
    setContextMenu(null);
    setLearningPaths(null);
    setSelectedPath(null);
  }

  // Handle right-click on a conversation
  function handleConversationContextMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    conversationId: string
  ) {
    event.preventDefault();
    setContextMenu({
      conversationId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  // Delete a conversation and its messages (cascades via FK)
  async function deleteConversation(conversationId: string) {
    setError(null);
    try {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId);

      if (error) {
        console.error("Error deleting conversation:", error);
        setError("Failed to delete conversation. Please try again.");
        return;
      }

      // Update local state
      setConversations((prev) =>
        prev.filter((conversation) => conversation.id !== conversationId)
      );

      if (currentConversationId === conversationId) {
        startNewConversation();
      }
    } catch (err) {
      console.error("Unexpected error deleting conversation:", err);
      setError("Failed to delete conversation. Please try again.");
    } finally {
      setContextMenu(null);
    }
  }

  // useEffect runs when the component first loads
  useEffect(() => {
    // Define an async function to check if a user is logged in
    async function checkUser() {
      // Ask Supabase: "Is there a logged-in user?"
      const { data: { user } } = await supabase.auth.getUser();
      
      // If no user is logged in...
      if (!user) {
        // Redirect them to the homepage (login page)
        router.push("/");
      } else {
        // If user IS logged in, save their data to state
        setUser(user);
      }
      
      // We're done checking, so stop showing the loading screen
      setLoading(false);
    }

    // Actually run the check when the page loads
    checkUser();
  }, [router]); // Re-run this if router changes (it won't, but required by React)

  // Function to handle sign out when user clicks the button
  async function handleSignOut() {
    // Tell Supabase to sign the user out
    await supabase.auth.signOut();
    
    // Redirect them back to the homepage
    router.push("/");
  }

  // Function to handle asking AI for book recommendations
  async function handleAskAI(e: React.FormEvent) {
    e.preventDefault(); // Prevent form from reloading the page
    
    // If prompt is empty, don't do anything
    if (!prompt.trim()) {
      return;
    }

    // Get the current user's session token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Not authenticated. Please log in again.");
      return;
    }

    // Clear error, start loading
    setError(null);
    setAiLoading(true);

    // Store the user's prompt temporarily for optimistic UI update
    const userPrompt = prompt;
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: currentConversationId || "temp",
      role: "user",
      content: userPrompt,
      created_at: new Date().toISOString(),
    };

    // Optimistically add user message to UI
    setMessages((prev) => [...prev, tempUserMessage]);
    setPrompt(""); // Clear input

    try {
      // Call our API route to get AI response
      const response = await fetch("/api/ask-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          prompt: userPrompt,
          conversation_id: currentConversationId,
        }),
      });

      // Parse the JSON response from our API
      const data = await response.json();

      // If the API returned an error...
      if (!response.ok) {
        const errorMsg = data.error || "Something went wrong";
        const details = data.details ? ` (${data.details})` : "";
        const hint = data.hint ? ` Hint: ${data.hint}` : "";
        setError(`${errorMsg}${details}${hint}`);
        if (process.env.NODE_ENV !== "production") {
          console.error("API Error:", data);
        }
        // Remove the optimistic message on error
        setMessages((prev) => prev.filter((msg) => msg.id !== tempUserMessage.id));
      } else {
          // Success! Reload messages to get the saved ones from database
          if (data.conversation_id) {
            setCurrentConversationId(data.conversation_id);
            // Reload messages to get the actual saved messages (this will also detect learning paths from DB)
            await loadMessages(data.conversation_id);
            // Reload conversations to get updated list
            await loadConversations();
            
            // Check if the NEW response contains learning paths - try multiple methods to detect and parse them
            // This will override any learning paths from the database if this is a new learning path response
            try {
            let detectedPaths: LearningPath[] | null = null;
            
            // Method 1: Check if server already parsed them
            if (data.response_type === "learning_paths" && data.learning_paths && Array.isArray(data.learning_paths) && data.learning_paths.length > 0) {
              try {
                // Validate and normalize learning paths structure
                const validPaths = (data.learning_paths as Partial<LearningPath>[]).map((path) => ({
                  ...path,
                  resources: Array.isArray(path.resources) ? path.resources : [],
                })) as LearningPath[];
                detectedPaths = validPaths;
              } catch (parseError) {
                console.error("Error parsing server-provided learning paths:", parseError);
              }
            }
            
            // Method 2: Check the raw response text for learning paths pattern
            if (!detectedPaths && data.response && typeof data.response === "string") {
              try {
                const pathPattern = /\*\*PATH\s+\d+:/i;
                if (pathPattern.test(data.response)) {
                  // Try parsing on client side
                  const parsedPaths = parseEnglishLearningPaths(data.response);
                  if (parsedPaths && parsedPaths.length > 0) {
                    detectedPaths = parsedPaths;
                  }
                }
              } catch (parseError) {
                console.error("Error parsing client-side learning paths:", parseError);
              }
            }
            
            // If we found learning paths, set them with raw text
            if (detectedPaths && detectedPaths.length > 0) {
              try {
                if (data.response && typeof data.response === "string") {
                  const pathPattern = /\*\*PATH\s+\d+:/i;
                  if (pathPattern.test(data.response)) {
                    // Add raw text to each path for display
                    const pathsWithText = detectedPaths!.map((path, index) => {
                      try {
                        return {
                          ...path,
                          rawText: extractPathText(data.response, index + 1),
                        };
                      } catch (extractError) {
                        console.error(`Error extracting text for path ${index + 1}:`, extractError);
                        return path;
                      }
                    });
                    setLearningPaths(pathsWithText);
                  } else {
                    setLearningPaths(detectedPaths);
                  }
                } else {
                  setLearningPaths(detectedPaths);
                }
              } catch (textExtractError) {
                console.error("Error adding raw text to learning paths:", textExtractError);
                // Still set the paths even if text extraction fails
                setLearningPaths(detectedPaths);
              }
            } else {
              // If not learning paths, clear any existing learning paths
              setLearningPaths(null);
              setSelectedPath(null);
            }
          } catch (error) {
            console.error("Error processing learning paths:", error);
            // Clear learning paths on error to avoid showing corrupted data
            setLearningPaths(null);
            setSelectedPath(null);
          }
        }
      }
    } catch (error) {
      // If network error or other problem occurred
      console.error("Error calling AI API:", error);
      let errorMessage = "Failed to connect to AI. Please check your connection and try again.";
      
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      
      setError(errorMessage);
      // Remove the optimistic message on error
      setMessages((prev) => prev.filter((msg) => msg.id !== tempUserMessage.id));
    } finally {
      // Always stop loading, whether success or error
      setAiLoading(false);
    }
  }

  // While we're checking if user is logged in, show a loading message
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // If there's no user (shouldn't happen because we redirect above), show nothing
  if (!user) {
    return null; // User is being redirected, so don't render anything
  }

  // Main dashboard UI (only shows if user is logged in)
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 flex">
      {/* Sidebar with conversations */}
      <aside className="w-72 border-r border-blue-100 bg-white/80 backdrop-blur-sm flex flex-col shadow-sm">
        <div className="p-5 border-b border-blue-100">
          <button
            onClick={startNewConversation}
            className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
          >
            + New Learning Path
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {conversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-sm text-slate-500 font-medium">
                No conversations yet
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Start a new one to begin
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  onContextMenu={(event) =>
                    handleConversationContextMenu(event, conv.id)
                  }
                  className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all duration-200 ${
                    currentConversationId === conv.id
                      ? "bg-gradient-to-r from-blue-50 to-blue-100/50 text-blue-900 font-semibold shadow-sm border border-blue-200"
                      : "text-slate-700 hover:bg-blue-50/50 border border-transparent hover:border-blue-100"
                  }`}
                >
                  <div className="truncate font-medium">{conv.title || "Untitled Conversation"}</div>
                  <div className="text-xs text-slate-500 mt-1.5">
                    {new Date(conv.updated_at).toLocaleDateString("en-US", { 
                      month: "short", 
                      day: "numeric",
                      year: new Date(conv.updated_at).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col bg-white/50">
        {/* Top navigation bar */}
        <nav className="border-b border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm">
          <div className="px-8 py-5 flex items-center justify-between">
            {/* App title on the left */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-700 to-blue-600 bg-clip-text text-transparent">
                Learning Assistant
              </h1>
            </div>
            
            {/* Sign out button on the right */}
            <button
              onClick={handleSignOut}
              className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 shadow-sm hover:shadow"
            >
              Sign out
            </button>
          </div>
          
          {/* Tab Navigation */}
          <div className="px-8 border-t border-blue-100">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("generate")}
                className={`px-6 py-3 text-sm font-semibold transition-all duration-200 border-b-2 ${
                  activeTab === "generate"
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                Generate Paths
              </button>
              <button
                onClick={() => setActiveTab("paths")}
                className={`px-6 py-3 text-sm font-semibold transition-all duration-200 border-b-2 ${
                  activeTab === "paths"
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                My Learning Paths
              </button>
            </div>
          </div>
        </nav>

        {/* Main content area - different based on active tab */}
        <main className="flex-1 flex flex-col">
          {/* Generate Paths Tab */}
          {activeTab === "generate" && (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
              {/* Welcome message section */}
              {!currentConversationId && messages.length === 0 && !learningPaths && (
            <div className="px-8 py-12 max-w-2xl mx-auto">
              <div className="text-center mb-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-xl">
                  <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h2 className="text-4xl font-bold text-slate-900 mb-3">
                  Welcome back!
                </h2>
                <p className="text-slate-600 mb-6 text-lg">
                  Logged in as <span className="font-semibold text-blue-700">{user.email}</span>
                </p>
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 text-left">
                  <p className="text-slate-700 leading-relaxed">
                    Tell me what you&apos;d like to learn about, and I&apos;ll create a personalized learning path with curated resources just for you!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Learning paths selection view */}
          {learningPaths && !selectedPath && !editingPath && (
            <div className="flex-1 overflow-y-auto px-8 py-10">
              <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Choose Your Learning Path
                  </h2>
                  <p className="text-slate-600 text-lg max-w-2xl mx-auto mb-6">
                    I&apos;ve created three personalized learning paths for you. Select the one that best fits your goals:
                  </p>
                  <button
                    onClick={async () => {
                      // Generate more learning paths by asking the AI
                      setError(null);
                      setAiLoading(true);
                      
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (!session) {
                          setError("Not authenticated. Please log in again.");
                          return;
                        }

                        const response = await fetch("/api/ask-ai", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${session.access_token}`,
                          },
                          body: JSON.stringify({
                            prompt: "Generate 3 more different learning paths for the same topic. Make them distinct from the previous ones.",
                            conversation_id: currentConversationId,
                          }),
                        });

                        const data = await response.json();

                        if (!response.ok) {
                          setError(data.error || "Failed to generate more paths");
                        } else {
                          if (data.conversation_id) {
                            setCurrentConversationId(data.conversation_id);
                            await loadMessages(data.conversation_id);
                            await loadConversations();
                            
                            // Parse new learning paths
                            if (data.response_type === "learning_paths" && data.learning_paths) {
                              setLearningPaths(data.learning_paths);
                            } else if (data.response && typeof data.response === "string") {
                              const pathPattern = /\*\*PATH\s+\d+:/i;
                              if (pathPattern.test(data.response)) {
                                const parsedPaths = parseEnglishLearningPaths(data.response);
                                if (parsedPaths && parsedPaths.length > 0) {
                                  const pathsWithText = parsedPaths.map((path, index) => ({
                                    ...path,
                                    rawText: extractPathText(data.response, index + 1),
                                  }));
                                  setLearningPaths(pathsWithText);
                                }
                              }
                            }
                          }
                        }
                      } catch (error) {
                        console.error("Error generating more paths:", error);
                        setError("Failed to generate more paths. Please try again.");
                      } finally {
                        setAiLoading(false);
                      }
                    }}
                    disabled={aiLoading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-white border-2 border-blue-200 text-blue-700 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Generate More Paths</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {learningPaths.map((path, index) => (
                    <div
                      key={index}
                      className="text-left p-7 rounded-2xl border-2 border-blue-100 bg-white hover:border-blue-300 hover:shadow-xl transition-all duration-300 group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center mb-4 transition-colors">
                        <span className="text-2xl font-bold text-blue-700">{index + 1}</span>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-blue-700 transition-colors">
                        {path.title}
                      </h3>
                      <p className="text-sm text-slate-600 mb-5 leading-relaxed line-clamp-3">
                        {path.description}
                      </p>
                      <div className="space-y-2 pt-4 border-t border-blue-50 mb-4">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-semibold">Timeline:</span> <span>{path.timeline}</span>
                        </div>
                        <div className="text-xs text-slate-500 line-clamp-2">
                          <span className="font-semibold">Why this path:</span> {path.why_this_path}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 pt-4 border-t border-blue-50">
                        <button
                          onClick={() => setSelectedPath(path)}
                          className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm"
                        >
                          View Details
                        </button>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingPath({ ...path });
                              setEditingPathIndex(index);
                            }}
                            className="flex-1 px-4 py-2 border-2 border-blue-200 text-blue-700 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors font-semibold text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const pathId = await saveLearningPath(path);
                              if (pathId) {
                                // Show success feedback
                                setError(null);
                                // Could add a toast notification here
                              }
                            }}
                            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold text-sm"
                          >
                            Add to My Paths
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Edit learning path view */}
          {editingPath && editingPathIndex !== null && (
            <div className="flex-1 overflow-y-auto px-8 py-10">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <button
                    onClick={() => {
                      setEditingPath(null);
                      setEditingPathIndex(null);
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-2 transition-colors group"
                  >
                    <svg className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to path selection
                  </button>
                </div>
                
                <div className="bg-white rounded-2xl border-2 border-blue-100 shadow-lg p-8">
                  <h2 className="text-2xl font-bold text-slate-900 mb-6">Edit Learning Path</h2>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Title</label>
                      <input
                        type="text"
                        value={editingPath.title}
                        onChange={(e) => setEditingPath({ ...editingPath, title: e.target.value })}
                        className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all duration-200"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                      <textarea
                        value={editingPath.description}
                        onChange={(e) => setEditingPath({ ...editingPath, description: e.target.value })}
                        className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all duration-200 resize-none"
                        rows={4}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Timeline</label>
                      <input
                        type="text"
                        value={editingPath.timeline}
                        onChange={(e) => setEditingPath({ ...editingPath, timeline: e.target.value })}
                        className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all duration-200"
                        placeholder="e.g., 3-4 months"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Why this path</label>
                      <textarea
                        value={editingPath.why_this_path}
                        onChange={(e) => setEditingPath({ ...editingPath, why_this_path: e.target.value })}
                        className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all duration-200 resize-none"
                        rows={3}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-4">Resources</label>
                      <div className="space-y-3">
                        {editingPath.resources.map((resource, idx) => (
                          <div key={idx} className="flex gap-3 items-start p-4 bg-blue-50 rounded-xl border border-blue-100">
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                              {resource.order || idx + 1}
                            </div>
                            <div className="flex-1 space-y-2">
                              <input
                                type="text"
                                value={resource.title}
                                onChange={(e) => {
                                  const newResources = [...editingPath.resources];
                                  newResources[idx] = { ...resource, title: e.target.value };
                                  setEditingPath({ ...editingPath, resources: newResources });
                                }}
                                className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                placeholder="Resource title"
                              />
                              {resource.author && (
                                <input
                                  type="text"
                                  value={resource.author}
                                  onChange={(e) => {
                                    const newResources = [...editingPath.resources];
                                    newResources[idx] = { ...resource, author: e.target.value };
                                    setEditingPath({ ...editingPath, resources: newResources });
                                  }}
                                  className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                  placeholder="Author/Channel/Host"
                                />
                              )}
                            </div>
                            <button
                              onClick={() => {
                                const newResources = editingPath.resources.filter((_, i) => i !== idx);
                                setEditingPath({ ...editingPath, resources: newResources });
                              }}
                              className="flex-shrink-0 text-red-600 hover:text-red-700 p-2"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex gap-3 pt-4 border-t border-blue-100">
                      <button
                        onClick={() => {
                          if (learningPaths && editingPathIndex !== null) {
                            const newPaths = [...learningPaths];
                            newPaths[editingPathIndex] = editingPath;
                            setLearningPaths(newPaths);
                            setEditingPath(null);
                            setEditingPathIndex(null);
                          }
                        }}
                        className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold text-sm"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => {
                          setEditingPath(null);
                          setEditingPathIndex(null);
                        }}
                        className="px-6 py-3 border-2 border-slate-200 text-slate-700 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors font-semibold text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Selected learning path view */}
          {selectedPath && (
            <div className="flex-1 overflow-y-auto px-8 py-10">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <button
                    onClick={() => setSelectedPath(null)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-2 transition-colors group"
                  >
                    <svg className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to path selection
                  </button>
                  <button
                    onClick={async () => {
                      if (selectedPath) {
                        // Save learning path to database first if not already saved
                        const pathId = await saveLearningPath(selectedPath);
                        setSelectedLearningPathId(pathId || null);
                        // Switch to My Learning Paths tab and show study chat
                        setActiveTab("paths");
                        setShowStudyChat(true);
                      }
                    }}
                    className="px-4 py-2 border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm font-semibold"
                  >
                    Start Study Chat
                  </button>
                </div>
                
                {/* Show raw English text if available, otherwise show structured view */}
                {selectedPath.rawText ? (
                  <div className="bg-white rounded-2xl border-2 border-blue-100 shadow-lg p-8">
                    <div className="prose prose-sm max-w-none">
                      <div className="whitespace-pre-wrap text-zinc-900">
                        {selectedPath.rawText.split('\n').map((line, index) => {
                          // Format headings
                          if (line.match(/^\*\*.*\*\*$/)) {
                            return (
                              <h2 key={index} className="text-2xl font-bold text-slate-900 mt-8 mb-4 pb-3 border-b border-blue-100">
                                {line.replace(/\*\*/g, '')}
                              </h2>
                            );
                          }
                          // Format bold text
                          if (line.match(/^[A-Z][^:]+:/)) {
                            const [label, ...valueParts] = line.split(':');
                            return (
                              <p key={index} className="mb-3">
                                <span className="font-semibold text-slate-900">{label}:</span>
                                <span className="text-slate-600 ml-2"> {valueParts.join(':')}</span>
                              </p>
                            );
                          }
                          // Format resource items (no links)
                          if (line.match(/^\d+\./)) {
                            // Remove any URLs that might be present but don't display them
                            const cleanedLine = line.replace(/(https?:\/\/[^\s]+)/g, '').trim();
                            return (
                              <p key={index} className="mb-3 ml-6 text-slate-600">
                                {cleanedLine}
                              </p>
                            );
                          }
                          // Regular text
                          return line.trim() ? (
                            <p key={index} className="mb-3 text-slate-700 leading-relaxed">{line}</p>
                          ) : (
                            <br key={index} />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-white rounded-2xl border-2 border-blue-100 shadow-lg p-8 mb-8">
                      <div className="flex items-start gap-4 mb-6">
                        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
                          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h2 className="text-3xl font-bold text-slate-900 mb-3">
                            {selectedPath.title}
                          </h2>
                          <p className="text-slate-600 text-base leading-relaxed mb-5">{selectedPath.description}</p>
                          <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl border border-blue-100">
                              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-sm font-semibold text-blue-700">Timeline:</span>
                              <span className="text-sm text-slate-700">{selectedPath.timeline}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="pt-6 border-t border-blue-100">
                        <p className="text-sm font-semibold text-slate-700 mb-2">Why this path:</p>
                        <p className="text-slate-600 leading-relaxed">{selectedPath.why_this_path}</p>
                      </div>
                    </div>

                    <h3 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                      <div className="w-1 h-8 bg-gradient-to-b from-blue-600 to-blue-400 rounded-full"></div>
                      Learning Resources (in order)
                    </h3>
                    
                    <div className="space-y-3">
                      {Array.isArray(selectedPath.resources) && selectedPath.resources.length > 0 ? (
                        selectedPath.resources
                          .filter((resource) => resource && resource.title) // Show resources with titles
                          .sort((a, b) => (a.order || 0) - (b.order || 0))
                          .map((resource, index) => {
                      const getIcon = () => {
                        switch (resource.type) {
                          case "book":
                            return "📚";
                          case "youtube_video":
                            return "🎥";
                          case "podcast":
                            return "🎙️";
                          case "online_course":
                            return "🎓";
                          default:
                            return "📖";
                        }
                      };

                      const getTypeLabel = () => {
                        switch (resource.type) {
                          case "book":
                            return "Book";
                          case "youtube_video":
                            return "YouTube Video";
                          case "podcast":
                            return "Podcast";
                          case "online_course":
                            return "Online Course";
                          default:
                            return "Resource";
                        }
                      };

                      return (
                        <div
                          key={index}
                          className="bg-white rounded-xl border-2 border-blue-100 p-5 hover:border-blue-300 hover:shadow-lg transition-all duration-200 group"
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white shadow-md group-hover:shadow-lg transition-shadow">
                              {resource.order || index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-lg">{getIcon()}</span>
                                    <span className="text-xs font-medium text-zinc-500 uppercase">
                                      {getTypeLabel()}
                                    </span>
                                  </div>
                                  <div className="font-semibold text-slate-900 block mb-2 break-words text-base">
                                    {resource.title || "Untitled Resource"}
                                  </div>
                                  <div className="text-sm text-slate-600 space-y-1">
                                    {resource.author && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">by</span>
                                        <span>{resource.author}</span>
                                      </div>
                                    )}
                                    {resource.channel && (
                                      <div>{resource.channel}</div>
                                    )}
                                    {resource.host && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">Hosted by</span>
                                        <span>{resource.host}</span>
                                      </div>
                                    )}
                                    {resource.platform && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">on</span>
                                        <span>{resource.platform}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                      ) : (
                        <div className="bg-blue-50 rounded-xl border-2 border-blue-100 p-8 text-center">
                          <svg className="w-12 h-12 mx-auto mb-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="text-slate-500 font-medium">No resources available for this learning path.</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Messages display area (only show when not viewing learning paths) */}
          {!learningPaths && !selectedPath && (
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
              {messages.length === 0 && currentConversationId ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-slate-500 font-medium">No messages in this conversation yet.</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-5 py-3 shadow-sm ${
                        message.role === "user"
                          ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white"
                          : "bg-white border border-slate-200 text-slate-800"
                      }`}
                    >
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input area (only show when not viewing selected learning path) */}
          {!selectedPath && (
            <div className="border-t border-blue-100 bg-white/80 backdrop-blur-sm p-6">
              <form onSubmit={handleAskAI} className="max-w-4xl mx-auto space-y-4">
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={learningPaths ? "Ask another question..." : "What would you like to learn about?"}
                    className="w-full rounded-2xl border-2 border-slate-200 px-5 py-4 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 resize-none transition-all duration-200 bg-white shadow-sm"
                    rows={3}
                    disabled={aiLoading}
                  />
                </div>
                
                {/* Submit button */}
                <div className="flex items-center justify-end">
                  <button
                    type="submit"
                    disabled={aiLoading || !prompt.trim()}
                    className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none flex items-center gap-2"
                  >
                    {aiLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>Thinking...</span>
                      </>
                    ) : (
                      <>
                        <span>Send</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Show error message if something went wrong */}
              {error && (
                <div className="mt-4 max-w-4xl mx-auto rounded-xl bg-red-50 border-2 border-red-200 p-4">
                  <p className="text-sm text-red-800 font-medium">{error}</p>
                </div>
              )}
            </div>
          )}
            </div>
          )}
          
          {/* My Learning Paths Tab */}
          {activeTab === "paths" && (
            <div className="flex-1 overflow-y-auto px-8 py-10">
              <div className="max-w-6xl mx-auto">
                {!selectedPath ? (
                  <>
                    <h2 className="text-3xl font-bold text-slate-900 mb-6">My Learning Paths</h2>
                    <p className="text-slate-600 mb-8">Track your progress and interact with your saved learning paths.</p>
                    {savedLearningPaths.length === 0 ? (
                      <div className="text-center py-16 bg-blue-50 rounded-2xl border-2 border-blue-100">
                        <svg className="w-16 h-16 mx-auto mb-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                        <p className="text-slate-600 font-medium">No learning paths saved yet</p>
                        <p className="text-slate-500 text-sm mt-2">Generate a learning path in the "Generate Paths" tab to get started</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {savedLearningPaths.map((path, index) => (
                          <div key={index} className="bg-white rounded-2xl border-2 border-blue-100 p-6">
                            <h3 className="text-xl font-bold text-slate-900 mb-2">{path.title}</h3>
                            <p className="text-slate-600 mb-4">{path.description}</p>
                            <div className="flex items-center gap-4 text-sm text-slate-500 mb-4">
                              <span>Timeline: {path.timeline}</span>
                            </div>
                            <div className="flex gap-3">
                              <button
                                onClick={() => {
                                  setSelectedPath(path);
                                  setShowStudyChat(false);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                View Path
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedPath(path);
                                  setShowStudyChat(true);
                                }}
                                className="px-4 py-2 border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                              >
                                Study Chat
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setSelectedPath(null);
                        setShowStudyChat(false);
                      }}
                      className="mb-6 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-2 transition-colors group"
                    >
                      <svg className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back to learning paths
                    </button>
                    
                    {/* Toggle between path view and study chat */}
                    <div className="mb-6 flex gap-2 border-b border-blue-100">
                      <button
                        onClick={() => setShowStudyChat(false)}
                        className={`px-6 py-3 text-sm font-semibold transition-all duration-200 border-b-2 ${
                          !showStudyChat
                            ? "border-blue-600 text-blue-700"
                            : "border-transparent text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Path Details
                      </button>
                      <button
                        onClick={() => setShowStudyChat(true)}
                        className={`px-6 py-3 text-sm font-semibold transition-all duration-200 border-b-2 ${
                          showStudyChat
                            ? "border-blue-600 text-blue-700"
                            : "border-transparent text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Study Chat
                      </button>
                    </div>

                    {!showStudyChat ? (
                      /* Learning Path Details View */
                      <div>
                        {selectedPath.rawText ? (
                          <div className="bg-white rounded-2xl border-2 border-blue-100 shadow-lg p-8">
                            <div className="prose prose-sm max-w-none">
                              <div className="whitespace-pre-wrap text-zinc-900">
                                {selectedPath.rawText.split('\n').map((line, index) => {
                                  if (line.match(/^\*\*.*\*\*$/)) {
                                    return (
                                      <h2 key={index} className="text-2xl font-bold text-slate-900 mt-8 mb-4 pb-3 border-b border-blue-100">
                                        {line.replace(/\*\*/g, '')}
                                      </h2>
                                    );
                                  }
                                  if (line.match(/^[A-Z][^:]+:/)) {
                                    const [label, ...valueParts] = line.split(':');
                                    return (
                                      <p key={index} className="mb-3">
                                        <span className="font-semibold text-slate-900">{label}:</span>
                                        <span className="text-slate-600 ml-2"> {valueParts.join(':')}</span>
                                      </p>
                                    );
                                  }
                                  if (line.match(/^\d+\./)) {
                                    const cleanedLine = line.replace(/(https?:\/\/[^\s]+)/g, '').trim();
                                    return (
                                      <p key={index} className="mb-3 ml-6 text-slate-600">
                                        {cleanedLine}
                                      </p>
                                    );
                                  }
                                  return line.trim() ? (
                                    <p key={index} className="mb-3 text-slate-700 leading-relaxed">{line}</p>
                                  ) : (
                                    <br key={index} />
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="bg-white rounded-2xl border-2 border-blue-100 shadow-lg p-8 mb-8">
                              <h2 className="text-3xl font-bold text-slate-900 mb-3">{selectedPath.title}</h2>
                              <p className="text-slate-600 text-base leading-relaxed mb-5">{selectedPath.description}</p>
                              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl border border-blue-100 w-fit">
                                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-sm font-semibold text-blue-700">Timeline:</span>
                                <span className="text-sm text-slate-700">{selectedPath.timeline}</span>
                              </div>
                            </div>
                            <h3 className="text-2xl font-bold text-slate-900 mb-6">Learning Resources</h3>
                            <div className="space-y-3">
                              {selectedPath.resources && selectedPath.resources.length > 0 ? (
                                selectedPath.resources
                                  .filter((r) => r && r.title)
                                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                                  .map((resource, idx) => (
                                    <div key={idx} className="bg-white rounded-xl border-2 border-blue-100 p-5">
                                      <div className="flex items-start gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white">
                                          {resource.order || idx + 1}
                                        </div>
                                        <div className="flex-1">
                                          <div className="font-semibold text-slate-900 mb-2">{resource.title}</div>
                                          {resource.author && (
                                            <div className="text-sm text-slate-600">by {resource.author}</div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))
                              ) : (
                                <div className="bg-blue-50 rounded-xl border-2 border-blue-100 p-8 text-center">
                                  <p className="text-slate-500 font-medium">No resources available</p>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      /* Study Chat View */
                      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                        <div className="mb-6">
                          <h3 className="text-2xl font-bold text-slate-900 mb-2">Study Chat: {selectedPath.title}</h3>
                          <p className="text-slate-600">Ask questions about the resources in this learning path</p>
                        </div>
                        <div className="flex-1 overflow-y-auto mb-6 space-y-6 min-h-[400px]">
                          {studyChatMessages.length === 0 ? (
                            <div className="text-center py-16">
                              <svg className="w-16 h-16 mx-auto mb-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              <p className="text-slate-600 font-medium">No messages yet</p>
                              <p className="text-slate-500 text-sm mt-2">Start asking questions about this learning path&apos;s resources</p>
                            </div>
                          ) : (
                            studyChatMessages.map((message) => (
                              <div
                                key={message.id}
                                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                              >
                                <div
                                  className={`max-w-[75%] rounded-2xl px-5 py-3 shadow-sm ${
                                    message.role === "user"
                                      ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white"
                                      : "bg-white border border-slate-200 text-slate-800"
                                  }`}
                                >
                                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="border-t border-blue-100 bg-white/80 backdrop-blur-sm p-6 rounded-2xl">
                          <form onSubmit={(e) => {
                            e.preventDefault();
                            // TODO: Implement study chat API call
                            setStudyChatPrompt("");
                          }} className="space-y-4">
                            <textarea
                              value={studyChatPrompt}
                              onChange={(e) => setStudyChatPrompt(e.target.value)}
                              placeholder="Ask a question about the resources in this learning path..."
                              className="w-full rounded-2xl border-2 border-slate-200 px-5 py-4 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 resize-none transition-all duration-200 bg-white shadow-sm"
                              rows={3}
                              disabled={studyChatLoading}
                            />
                            <div className="flex justify-end">
                              <button
                                type="submit"
                                disabled={studyChatLoading || !studyChatPrompt.trim()}
                                className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none"
                              >
                                {studyChatLoading ? "Thinking..." : "Send"}
                              </button>
                            </div>
                          </form>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      {contextMenu && (
        <div
          className="fixed z-50 w-48 rounded-xl border-2 border-slate-200 bg-white shadow-xl"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            onClick={() => deleteConversation(contextMenu.conversationId)}
          >
            Delete conversation
          </button>
        </div>
      )}
    </div>
  );
}

