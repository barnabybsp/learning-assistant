import { NextRequest, NextResponse } from "next/server"; // Next.js types for API routes
import OpenAI from "openai"; // OpenAI SDK
import { createServerClient } from "@/lib/supabaseServer"; // Server-side Supabase client

// Type definitions for learning paths
type LearningPathResource = {
  order: number;
  type: string;
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
};

// Function to parse English text learning paths into structured format
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
          // Match resource line without requiring URL: "1. Book: Title by Author"
          const match = line.match(/^\d+\.\s*(.+)/);
          
          if (match) {
            const resourceText = match[1].trim();
            
            // Determine resource type based on keywords
            let type = "other";
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
            
            // Extract title and author/channel (format: "Resource Type: Title by Author")
            // Try different patterns
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

// Handle POST requests to this API route
export async function POST(request: NextRequest) {
  try {
    // Authenticate user first
    const clientData = await createServerClient(request);
    if (!clientData) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const { supabase, user } = clientData;

    // Test that we can query conversations (verifies RLS and auth.uid() works)
    const { error: testError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);
    
    if (testError) {
      console.error("RLS test failed - auth.uid() may not be working:", testError);
      console.error("This suggests the JWT token isn't being recognized for RLS");
    } else {
      console.log("RLS test passed - can query conversations, auth.uid() is working");
    }

    // Check if OpenAI API key is configured
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set in environment variables");
      return NextResponse.json(
        { error: "OpenAI API key is not configured" },
        { status: 500 }
      );
    }

    // Get the prompt and optional conversation_id from the request body
    const { prompt, conversation_id } = await request.json();

    // If no prompt was provided, return an error
    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    let currentConversationId = conversation_id || null;
    let conversationTitle: string | null = null;

    // If no conversation_id, create a new conversation
    if (!currentConversationId) {
      // Generate a title from the first message (truncate to 50 chars)
      conversationTitle = prompt.length > 50 ? prompt.substring(0, 50) + "..." : prompt;

      const { data: newConversation, error: convError } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: conversationTitle,
        })
        .select()
        .single();

      if (convError || !newConversation) {
        console.error("Error creating conversation:", convError);
        return NextResponse.json(
          { error: "Failed to create conversation" },
          { status: 500 }
        );
      }

      currentConversationId = newConversation.id;
    } else {
      // Verify the conversation belongs to the user
      const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .select("id, user_id")
        .eq("id", currentConversationId)
        .single();

      if (convError || !conversation || conversation.user_id !== user.id) {
        return NextResponse.json(
          { error: "Conversation not found or access denied" },
          { status: 403 }
        );
      }
    }

    // Fetch all previous messages for this conversation (ordered by created_at)
    const { data: previousMessages, error: messagesError } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", currentConversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to fetch conversation history" },
        { status: 500 }
      );
    }

    // Build messages array for OpenAI
    const systemMessage = {
      role: "system" as const,
      content: `You are a helpful learning assistant that creates personalized learning paths for users.

Your conversation flow should be:
1. When a user first tells you what they want to learn, ask 3-4 thoughtful follow-up questions to understand:
   - Their current knowledge level
   - Their learning goals and what they want to achieve
   - Their preferred learning style (visual, reading, hands-on, etc.)
   - Time commitment they can make
   - Any specific areas they want to focus on

2. After the user answers your follow-up questions (typically after 3-4 Q&A exchanges), you should have enough information. Then generate exactly 3 different learning paths. Each learning path should be a structured roadmap with:
   - A title describing the approach (e.g., "Beginner-Friendly Foundation", "Fast-Track Intensive", "Comprehensive Deep Dive")
   - A brief description (2-3 sentences) of the learning approach
   - A list of resources in the EXACT ORDER the user should consume them (include 5-10 resources total):
     * Books (with titles and authors)
     * YouTube videos (with titles and channel names)
     * Podcasts (with titles and episode/host names)
     * Online courses (with platform names)
     * Other relevant resources (articles, tutorials, documentation)
   - An estimated timeline (e.g., "2-3 months", "6 weeks", "1 year")
   - Why this path might suit the user (1-2 sentences)
   
   IMPORTANT: 
   - ALL resources MUST be REAL and VERIFIABLE - use actual books, videos, courses, and articles that exist
   - DO NOT include URLs or links - just provide resource names, authors, and platforms
   - Resources MUST be ordered in a logical learning sequence (start with fundamentals, progress to advanced)
   - Mix different resource types to create a well-rounded learning experience

3. Format your response based on the conversation stage:
   - If asking follow-up questions: Ask naturally in a conversational way
   - If generating learning paths: Present exactly 3 learning paths in clear, readable English text format
     
     Format the learning paths like this (use clear headings and structure):
     
     **PATH 1: [Title of Learning Path]**
     
     [2-3 sentence description of this learning approach]
     
     Timeline: [e.g., "3-4 months" or "6-8 weeks"]
     Why this path: [1-2 sentences explaining why this suits the user]
     
     Resources (in order):
     1. [Resource Type]: [Title] by [Author/Channel/Host]
        [Additional details if applicable]
     2. [Resource Type]: [Title] by [Author/Channel/Host]
     3. [Resource Type]: [Title] by [Author/Channel/Host]
     [Continue with 5-10 resources total]
     
     **PATH 2: [Title of Learning Path]**
     
     [2-3 sentence description]
     
     Timeline: [time estimate]
     Why this path: [explanation]
     
     Resources (in order):
     1. [Resource Type]: [Title] by [Author/Channel/Host]
     2. [Resource Type]: [Title] by [Author/Channel/Host]
     [Continue with resources...]
     
     **PATH 3: [Title of Learning Path]**
     
     [2-3 sentence description]
     
     Timeline: [time estimate]
     Why this path: [explanation]
     
     Resources (in order):
     1. [Resource Type]: [Title] by [Author/Channel/Host]
     2. [Resource Type]: [Title] by [Author/Channel/Host]
     [Continue with resources...]

CRITICAL INSTRUCTIONS:
- Write in clear, readable English - NOT JSON, NOT code, NOT TypeScript
- Always generate exactly 3 learning paths
- Make each path distinct with different approaches (e.g., beginner vs advanced, fast vs comprehensive, theory vs practical)
- ALL resources MUST be REAL and VERIFIABLE - use actual existing books, videos, courses, articles that you know exist
- DO NOT include URLs or links - just provide resource names, authors, channels, and platforms
- Resources MUST be numbered in order (1, 2, 3, etc.) representing the learning sequence
- Include 5-10 resources per path, mixing different resource types (books, videos, courses, podcasts, articles)
- Use clear formatting with **bold** for path titles and numbered lists for resources
- Only generate learning paths when you have enough information (typically after 3-4 follow-up questions are answered)`,
    };

    // Convert previous messages to OpenAI format (exclude system messages from DB)
    const historyMessages = (previousMessages || [])
      .filter((msg) => msg.role !== "system")
      .map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));

    // Add the new user message
    const userMessage = {
      role: "user" as const,
      content: prompt,
    };

    // Combine all messages: system + history + new user message
    const messages = [systemMessage, ...historyMessages, userMessage];

    // Create OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    // Determine if we should expect learning paths (check if we have enough conversation history)
    const messageCount = historyMessages.length;
    const shouldGeneratePaths = messageCount >= 5; // At least initial query + 3-4 follow-up Q&A pairs

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      max_tokens: shouldGeneratePaths ? 3000 : 500, // More tokens for English text learning paths
    });

    // Extract the AI's response text
    const aiResponse = completion.choices[0]?.message?.content || "No response generated";
    
    // Check if the response contains learning paths (look for path markers)
    let learningPaths = null;
    let responseType: "question" | "learning_paths" = "question";
    
    // Check if response contains learning paths by looking for path markers
    const pathPattern = /\*\*PATH\s+\d+:/i;
    if (shouldGeneratePaths && pathPattern.test(aiResponse)) {
      // Parse the English text to extract learning paths
      learningPaths = parseEnglishLearningPaths(aiResponse);
      if (learningPaths && learningPaths.length >= 1) {
        responseType = "learning_paths";
      }
    }

    // Save user message to database
    const { data: userMsgData, error: userMsgError } = await supabase.from("messages").insert({
      conversation_id: currentConversationId,
      user_id: user.id,
      role: "user",
      content: prompt,
    }).select();

    if (userMsgError) {
      console.error("Error saving user message:", userMsgError);
      console.error("Error code:", userMsgError.code);
      console.error("Error message:", userMsgError.message);
      console.error("Error details:", userMsgError.details);
      console.error("Error hint:", userMsgError.hint);
      // Return error with full details for debugging
      return NextResponse.json(
        { 
          error: "Failed to save message. Please check your database permissions.",
          details: userMsgError.message,
          code: userMsgError.code,
          hint: userMsgError.hint
        },
        { status: 500 }
      );
    }

    console.log("Successfully saved user message:", userMsgData);

    // Save assistant response to database
    const { error: assistantMsgError } = await supabase.from("messages").insert({
      conversation_id: currentConversationId,
      user_id: user.id,
      role: "assistant",
      content: aiResponse,
    });

    if (assistantMsgError) {
      console.error("Error saving assistant message:", assistantMsgError);
      // Return error instead of continuing silently
      return NextResponse.json(
        { 
          error: "Failed to save AI response. Please check your database permissions.",
          details: assistantMsgError.message 
        },
        { status: 500 }
      );
    }

    // Update conversation's updated_at timestamp
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", currentConversationId);

    // Return the AI's response and conversation_id
    return NextResponse.json({
      response: aiResponse,
      conversation_id: currentConversationId,
      response_type: responseType,
      learning_paths: learningPaths,
    });
  } catch (error) {
    // If something goes wrong, return an error message
    console.error("OpenAI API error:", error);

    // Provide more specific error messages
    let errorMessage = "Failed to get AI response. Please try again.";
    if (error instanceof Error) {
      errorMessage = error.message;
      // Check for common OpenAI API errors
      if (error.message.includes("API key")) {
        errorMessage = "OpenAI API key is invalid or missing.";
      } else if (error.message.includes("rate limit")) {
        errorMessage = "Rate limit exceeded. Please try again later.";
      } else if (error.message.includes("insufficient_quota")) {
        errorMessage = "OpenAI API quota exceeded. Please check your account.";
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

