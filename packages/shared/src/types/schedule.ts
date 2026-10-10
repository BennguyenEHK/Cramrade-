// placeholder, replaced by the a5-schedule-engine branch
export const PACES = ['light', 'normal', 'heavy'] as const;
export type Pace = (typeof PACES)[number];
