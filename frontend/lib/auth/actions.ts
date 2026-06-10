'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Signs the current user out of Supabase and redirects to /login.
 *
 * Must be called from a "use client" component or a Server Component that
 * renders a <form action={signOut}> — not from a Route Handler.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
