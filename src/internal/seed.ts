import { UserContext } from "../types";
import * as uuid from "uuid";

// Flag-specific seed resolution. As in Go and Java, an explicit request seedId
// wins; otherwise the same seed-type switch as Decider._resolveSeed
// (decision.ts) - PROFILE_ID/USER_ID/SESSION_ID/DEVICE_ID/SEED_ID - picks the
// typed field. Unlike experiments, flags never exclude on an unresolvable
// seed: Go/Java fabricate a random seed instead, so a flag decision always
// resolves to *some* bucket rather than failing closed.
export const FlagSeedType = {
  Profile: "PROFILE_ID",
  User: "USER_ID",
  Session: "SESSION_ID",
  Device: "DEVICE_ID",
  Custom: "SEED_ID",
} as const;

export type SeedResolution = {
  seedId: string;
  seedType: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  return value != null && value.length > 0 ? value : undefined;
}

function contextString(context: UserContext | undefined, fieldName: string): string | undefined {
  const value = context?.[fieldName];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function resolveFlagSeed(
  seedType: string | undefined,
  requestSeedId: string | undefined,
  context: UserContext | undefined,
  profileId: string | undefined,
  userId: string | undefined,
): SeedResolution {
  const explicitSeedId = nonEmpty(requestSeedId);
  if (explicitSeedId) {
    return { seedId: explicitSeedId, seedType: FlagSeedType.Custom };
  }

  switch (seedType) {
    case FlagSeedType.Custom:
      break;
    case FlagSeedType.User: {
      const value = nonEmpty(userId) ?? contextString(context, "userId");
      if (value) {
        return { seedId: value, seedType: FlagSeedType.User };
      }
      break;
    }
    case FlagSeedType.Session: {
      const value = contextString(context, "sessionId");
      if (value) {
        return { seedId: value, seedType: FlagSeedType.Session };
      }
      break;
    }
    case FlagSeedType.Device: {
      const value = contextString(context, "deviceId");
      if (value) {
        return { seedId: value, seedType: FlagSeedType.Device };
      }
      break;
    }
    default: {
      const value = nonEmpty(profileId) ?? contextString(context, "profileId");
      if (value) {
        return { seedId: value, seedType: FlagSeedType.Profile };
      }
      break;
    }
  }

  return { seedId: uuid.v4(), seedType: "NONE" };
}
