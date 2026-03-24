export interface StableProfile {
  readonly userId: string;
  readonly role?: string;
  readonly preferences: readonly string[];
  readonly traits: readonly string[];
}

export interface DynamicProfile {
  readonly currentProjects: readonly string[];
  readonly recentInterests: readonly string[];
  readonly activeContexts: readonly string[];
}

export interface UserProfile {
  readonly stable: StableProfile;
  readonly dynamic: DynamicProfile;
  readonly lastUpdated: string;
}
