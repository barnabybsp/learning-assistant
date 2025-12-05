import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Creates an authenticated Supabase client from a Next.js request
 * Extracts the authorization token from the request headers
 * 
 * IMPORTANT: For RLS to work, the JWT token must be passed in a way that
 * Supabase can extract the user ID. We use the Authorization header which
 * Supabase automatically uses for RLS policy evaluation.
 */
export async function createServerClient(request: NextRequest) {
  // Extract the Authorization header
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const accessToken = authHeader.replace("Bearer ", "");

  // Create a Supabase client with the JWT token in the Authorization header
  // This is the key: Supabase will extract auth.uid() from the JWT in the header
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // Verify the token and get the user to ensure it's valid
  const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    console.error("Error verifying user token:", userError);
    return null;
  }

  // The client is now configured with the JWT in headers
  // Supabase will automatically use this for RLS policy evaluation
  // Test that auth.uid() works by making a simple query
  // (This is just for verification, not required for the client to work)
  
  return { supabase, user };
}


