import { useEffect, useState } from 'react'

/**
 * Auth callback page for liliplanet unified login.
 *
 * Flow:
 *   1. User clicks "Login" on the landing page
 *   2. Redirects to login.liliplanet.net?redirect=memrosetta.liliplanet.net/auth/callback
 *   3. User logs in (Google/Kakao/Naver/email)
 *   4. Redirected back here with ?token=JWT
 *   5. JWT stored in localStorage, redirect to home
 */
export function AuthCallback() {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')

    if (!token) {
      setStatus('error')
      return
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      localStorage.setItem('memrosetta_token', token)
      localStorage.setItem('memrosetta_email', payload.sub ?? '')
      localStorage.setItem('memrosetta_user_id', String(payload.user_id ?? ''))
      setEmail(payload.sub ?? null)
      setStatus('success')

      // Clean URL and redirect after brief display
      setTimeout(() => {
        window.history.replaceState({}, '', '/')
        window.location.href = '/'
      }, 2000)
    } catch {
      setStatus('error')
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        {status === 'processing' && (
          <>
            <div className="mb-4 font-[Bricolage_Grotesque] text-xl font-bold" style={{ color: 'oklch(0.22 0.01 85)' }}>
              Processing login...
            </div>
            <p style={{ color: 'oklch(0.45 0.01 85)' }}>Please wait.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="mb-4 font-[Bricolage_Grotesque] text-xl font-bold" style={{ color: 'oklch(0.22 0.01 85)' }}>
              Logged in
            </div>
            <p className="mb-2" style={{ color: 'oklch(0.45 0.01 85)' }}>
              {email ? `Welcome, ${email}` : 'Login successful.'}
            </p>
            <p className="text-sm" style={{ color: 'oklch(0.55 0.01 85)' }}>Redirecting...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="mb-4 font-[Bricolage_Grotesque] text-xl font-bold" style={{ color: 'oklch(0.22 0.01 85)' }}>
              Login failed
            </div>
            <p className="mb-4" style={{ color: 'oklch(0.45 0.01 85)' }}>
              No token received. Please try again.
            </p>
            <a
              href="/"
              className="inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: 'oklch(0.52 0.14 65)' }}
            >
              Back to home
            </a>
          </>
        )}
      </div>
    </div>
  )
}
