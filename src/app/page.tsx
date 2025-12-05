"use client"; // Client component (uses hooks and browser features)

import { useState, useEffect } from "react"; // React hooks
import { supabase } from "@/lib/supabaseClient"; // Supabase client
import { useRouter } from "next/navigation"; // Next.js navigation

export default function Home() {
  // State for email input field
  const [email, setEmail] = useState("");
  
  // State for password input field
  const [password, setPassword] = useState("");
  
  // State for showing success/error messages
  const [status, setStatus] = useState<string | null>(null);
  
  // State for showing "Working..." on buttons during API calls
  const [loading, setLoading] = useState(false);
  
  // State for tracking if we're checking if user is already logged in
  const [checking, setChecking] = useState(true);
  
  // Router for redirecting users
  const router = useRouter();

  // Check if user is already logged in when page first loads
  useEffect(() => {
    // Async function to check auth status
    async function checkUser() {
      // Ask Supabase: "Is there already a logged-in user?"
      const { data: { user } } = await supabase.auth.getUser();
      
      // If yes, user is already logged in...
      if (user) {
        // Redirect them to the dashboard (no need to show login form)
        router.push("/dashboard");
      } else {
        // If no user, stop the "checking" state and show the login form
        setChecking(false);
      }
    }
    
    // Run the check
    checkUser();
  }, [router]); // Re-run if router changes (it won't, but React requires it)

  // Handle the "Sign up" button click
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault(); // Prevent page reload (default form behavior)
    setLoading(true); // Show "Working..." on button
    setStatus(null); // Clear any previous messages

    // Ask Supabase to create a new user account
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    // If there's an error (e.g., weak password, email already used)...
    if (error) {
      setStatus(`Sign up error: ${error.message}`); // Show error message
    } else {
      // Success! Tell user to check their email
      setStatus("Check your email to confirm your account.");
    }

    setLoading(false); // Stop showing "Working..."
  }

  // Handle the "Sign in" button click
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault(); // Prevent page reload
    setLoading(true); // Show "Working..." on button
    setStatus(null); // Clear previous messages

    // Ask Supabase to sign in with email + password
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If there's an error (e.g., wrong password, user doesn't exist)...
    if (error) {
      setStatus(`Sign in error: ${error.message}`); // Show error
    } else {
      // Success! User is now logged in, so redirect to dashboard
      router.push("/dashboard");
    }

    setLoading(false); // Stop showing "Working..."
  }

  // While checking if user is already logged in, show loading screen
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Main login/signup form (only shows if user is NOT logged in)
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50/50 via-white to-blue-50/30 p-4">
      {/* Centered white card containing the form */}
      <main className="w-full max-w-md rounded-2xl border-2 border-blue-100 bg-white/90 backdrop-blur-sm p-10 shadow-xl">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-700 to-blue-600 bg-clip-text text-transparent mb-2">
            Learning Assistant
          </h1>
          <p className="text-slate-500 text-sm">Welcome back! Sign in to continue.</p>
        </div>

        {/* Form with email and password fields */}
        <form className="space-y-5">
          {/* Email input */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white"
              value={email} // Controlled input: value comes from state
              onChange={(e) => setEmail(e.target.value)} // Update state when user types
              placeholder="you@example.com"
            />
          </div>

          {/* Password input */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Password
            </label>
            <input
              type="password"
              className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white"
              value={password} // Controlled input
              onChange={(e) => setPassword(e.target.value)} // Update state when user types
              placeholder="At least 6 characters"
            />
          </div>

          {/* Buttons: Sign up and Sign in */}
          <div className="flex flex-col gap-3 pt-2">
            {/* Sign in button */}
            <button
              onClick={handleSignIn} // Run handleSignIn when clicked
              disabled={loading} // Disable while loading
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Working...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
            
            {/* Sign up button */}
            <button
              onClick={handleSignUp} // Run handleSignUp when clicked
              disabled={loading} // Disable button while loading
              className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
            >
              {loading ? "Working..." : "Sign up"}
            </button>
          </div>
        </form>

        {/* Status message area (shows errors or success messages) */}
        {status && ( // Only render if status is not null
          <div className={`mt-5 rounded-xl p-4 ${
            status.toLowerCase().includes("error") 
              ? "bg-red-50 border-2 border-red-200" 
              : "bg-blue-50 border-2 border-blue-200"
          }`}>
            <p className={`text-sm font-medium ${
              status.toLowerCase().includes("error")
                ? "text-red-800"
                : "text-blue-800"
            }`} data-testid="status-message">
              {status} {/* Display the message */}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
