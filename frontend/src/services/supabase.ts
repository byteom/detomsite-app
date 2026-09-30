const getSupabaseConfig = () => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return { url, anonKey }
}

export const isSupabaseConfigured = () => {
  const { url, anonKey } = getSupabaseConfig()
  return Boolean(url && anonKey && url.includes('supabase.co'))
}

/* Best-effort profile mirror to Supabase. NEVER rejects.
 *
 * PENTEST/RELIABILITY FIX. This used to `throw` on a non-OK response, and the
 * main AuthPage calls it fire-and-forget (no `await`, no `.catch`). The project's
 * anon key is now revoked, so every student login produced a rejected promise
 * with nobody handling it — an unhandled rejection on the hottest path in the
 * app, plus a pointless round-trip that also shipped the student's email and
 * name to a third-party host.
 *
 * Swallowing the error here fixes every caller at once (AuthPage, UserLogin,
 * UserRegister, AdminLogin, VendorRegister) instead of patching five call sites,
 * and a profile mirror is genuinely optional: the FastAPI backend is the system
 * of record, so a failure here must never affect sign-in. */
export async function syncProfileToSupabase(profile: { id: string; email: string; name: string; role: string }) {
  const { url, anonKey } = getSupabaseConfig()

  if (!isSupabaseConfigured() || !url || !anonKey) return null

  try {
    const response = await fetch(`${url}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        // Don't error when the same profile already exists (re-logins)
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        created_at: new Date().toISOString(),
      }),
    })

    if (!response.ok) return null

    return await response.json()
  } catch {
    // Offline, blocked by an extension, 401 from a revoked key — none of it
    // should surface to a user who is trying to log in.
    return null
  }
}
