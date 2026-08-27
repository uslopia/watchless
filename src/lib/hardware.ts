// On-device model: flag machines well below the recommendation so the popup can warn before a
// slow session. Missing values never block — blocking on the unknown would disable the extension
// for everyone. navigator.deviceMemory caps at 8 by spec, so the memory recommendation must
// stay reachable.
export const RECO = { memory: 8, cores: 4 };

export interface Hw {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function weakReasons({ deviceMemory, hardwareConcurrency }: Hw): string[] {
  const reasons: string[] = [];
  if (deviceMemory != null && deviceMemory < RECO.memory) reasons.push('memory');
  if (hardwareConcurrency != null && hardwareConcurrency < RECO.cores) reasons.push('cores');
  return reasons;
}

// Lanes for the analyze phase. Nano does overlap prompts, but sublinearly — two chunks measured
// at 27.4 s of work for 17.1 s of wall time. Each lane also holds its own cloned session, so a
// machine below the recommendation runs one at a time. Unknown values land on 2, the measured
// default.
export function defaultLanes(hw: Hw): number {
  if (weakReasons(hw).length) return 1;
  return (hw.hardwareConcurrency ?? 0) >= 8 ? 3 : 2;
}
