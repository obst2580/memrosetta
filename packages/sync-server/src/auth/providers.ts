import type { AuthenticatedUser, DeviceAuthStart, OAuthProvider } from '../storage.js';

export interface ProviderStartResult extends DeviceAuthStart {}

export type PollResult =
  | { readonly status: 'pending'; readonly intervalSeconds?: number }
  | { readonly status: 'approved'; readonly user: AuthenticatedUser }
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'expired'; readonly reason: string };

export async function startProviderDeviceFlow(
  provider: OAuthProvider,
  deviceId: string,
): Promise<ProviderStartResult> {
  switch (provider) {
    case 'github':
      return startGitHubDeviceFlow(deviceId);
    case 'google':
      return startGoogleDeviceFlow(deviceId);
  }
}

export async function pollProviderDeviceFlow(
  provider: OAuthProvider,
  providerDeviceCode: string,
): Promise<PollResult> {
  switch (provider) {
    case 'github':
      return pollGitHubDeviceFlow(providerDeviceCode);
    case 'google':
      return pollGoogleDeviceFlow(providerDeviceCode);
  }
}

async function startGitHubDeviceFlow(deviceId: string): Promise<ProviderStartResult> {
  const clientId = process.env.MEMROSETTA_GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new Error('MEMROSETTA_GITHUB_CLIENT_ID is not set');
  }

  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'read:user user:email',
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub device start failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  return {
    provider: 'github',
    deviceId,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    intervalSeconds: body.interval,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    providerDeviceCode: body.device_code,
  };
}

async function pollGitHubDeviceFlow(providerDeviceCode: string): Promise<PollResult> {
  const clientId = process.env.MEMROSETTA_GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new Error('MEMROSETTA_GITHUB_CLIENT_ID is not set');
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: providerDeviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub device poll failed: ${response.status} ${response.statusText}`);
  }

  const tokenBody = await response.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  };

  if (!tokenBody.access_token) {
    if (tokenBody.error === 'authorization_pending' || tokenBody.error === 'slow_down') {
      return { status: 'pending', intervalSeconds: tokenBody.interval };
    }
    if (tokenBody.error === 'expired_token') {
      return { status: 'expired', reason: tokenBody.error_description ?? 'GitHub device code expired' };
    }
    if (tokenBody.error === 'access_denied') {
      return { status: 'denied', reason: tokenBody.error_description ?? 'GitHub access denied' };
    }
    return { status: 'denied', reason: tokenBody.error_description ?? 'GitHub authorization failed' };
  }

  const accessToken = tokenBody.access_token;
  const profileResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'memrosetta-sync-server',
    },
  });
  if (!profileResponse.ok) {
    throw new Error(`GitHub user profile fetch failed: ${profileResponse.status} ${profileResponse.statusText}`);
  }
  const profile = await profileResponse.json() as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
  };

  let email = profile.email;
  if (!email) {
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'memrosetta-sync-server',
      },
    });
    if (emailResponse.ok) {
      const emails = await emailResponse.json() as readonly {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      email = emails.find(e => e.primary && e.verified)?.email
        ?? emails.find(e => e.verified)?.email
        ?? null;
    }
  }

  return {
    status: 'approved',
    user: {
      userId: '',
      provider: 'github',
      providerSubject: String(profile.id),
      email,
      displayName: profile.name ?? profile.login ?? null,
    },
  };
}

async function startGoogleDeviceFlow(deviceId: string): Promise<ProviderStartResult> {
  const clientId = process.env.MEMROSETTA_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('MEMROSETTA_GOOGLE_CLIENT_ID is not set');
  }

  const response = await fetch('https://oauth2.googleapis.com/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'openid email profile',
    }),
  });

  if (!response.ok) {
    throw new Error(`Google device start failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as {
    device_code: string;
    user_code: string;
    verification_url?: string;
    verification_uri?: string;
    expires_in: number;
    interval: number;
  };

  return {
    provider: 'google',
    deviceId,
    userCode: body.user_code,
    verificationUri: body.verification_uri ?? body.verification_url ?? 'https://www.google.com/device',
    intervalSeconds: body.interval,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    providerDeviceCode: body.device_code,
  };
}

async function pollGoogleDeviceFlow(providerDeviceCode: string): Promise<PollResult> {
  const clientId = process.env.MEMROSETTA_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('MEMROSETTA_GOOGLE_CLIENT_ID is not set');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    device_code: providerDeviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const clientSecret = process.env.MEMROSETTA_GOOGLE_CLIENT_SECRET;
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const tokenBody = await response.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  };

  if (!response.ok || !tokenBody.access_token) {
    if (tokenBody.error === 'authorization_pending' || tokenBody.error === 'slow_down') {
      return { status: 'pending', intervalSeconds: tokenBody.interval };
    }
    if (tokenBody.error === 'expired_token') {
      return { status: 'expired', reason: tokenBody.error_description ?? 'Google device code expired' };
    }
    if (tokenBody.error === 'access_denied') {
      return { status: 'denied', reason: tokenBody.error_description ?? 'Google access denied' };
    }
    return { status: 'denied', reason: tokenBody.error_description ?? 'Google authorization failed' };
  }

  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
    },
  });
  if (!userResponse.ok) {
    throw new Error(`Google userinfo fetch failed: ${userResponse.status} ${userResponse.statusText}`);
  }

  const userInfo = await userResponse.json() as {
    sub: string;
    email?: string;
    name?: string;
  };

  return {
    status: 'approved',
    user: {
      userId: '',
      provider: 'google',
      providerSubject: userInfo.sub,
      email: userInfo.email ?? null,
      displayName: userInfo.name ?? userInfo.email ?? null,
    },
  };
}
