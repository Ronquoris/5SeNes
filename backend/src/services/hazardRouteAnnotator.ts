import { db } from '../db/client.js';
import { distanceToLineMeters, haversineMeters } from './geo.js';
import type { RouteResult, RouteStep } from './osrm.js';

export interface HazardWarning {
  hazardId: string;
  type: string;
  severity: string;
  distanceFromStepMeters: number;
}

interface HazardRow {
  id: string;
  lat: number;
  lon: number;
  type: string;
  severity: string;
  resolved_at: string | null;
}

const HAZARD_CORRIDOR_METERS = 25;

export type AnnotatedStep = RouteStep & { hazardWarnings: HazardWarning[] };
export type AnnotatedRoute = Omit<RouteResult, 'steps'> & { steps: AnnotatedStep[] };

export function annotateRouteWithHazards(route: RouteResult): AnnotatedRoute {
  const activeHazards = db
    .prepare('SELECT id, lat, lon, type, severity, resolved_at FROM hazard_reports WHERE resolved_at IS NULL')
    .all() as unknown as HazardRow[];

  const relevantHazards = activeHazards.filter(
    (h) => distanceToLineMeters(h.lat, h.lon, route.geometry.coordinates) <= HAZARD_CORRIDOR_METERS
  );

  const warningsByStepIndex = new Map<number, HazardWarning[]>();

  // Each hazard attaches to whichever single step is closest, so it's only announced once.
  for (const hazard of relevantHazards) {
    let nearestStep: RouteStep | null = null;
    let nearestDist = Infinity;
    for (const step of route.steps) {
      const dist = haversineMeters(step.location.lat, step.location.lon, hazard.lat, hazard.lon);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestStep = step;
      }
    }
    if (!nearestStep || nearestDist > HAZARD_CORRIDOR_METERS) continue;

    const warning: HazardWarning = {
      hazardId: hazard.id,
      type: hazard.type,
      severity: hazard.severity,
      distanceFromStepMeters: Math.round(nearestDist),
    };
    const existing = warningsByStepIndex.get(nearestStep.index) ?? [];
    existing.push(warning);
    warningsByStepIndex.set(nearestStep.index, existing);
  }

  const steps: AnnotatedStep[] = route.steps.map((step) => ({
    ...step,
    hazardWarnings: (warningsByStepIndex.get(step.index) ?? []).sort(
      (a, b) => a.distanceFromStepMeters - b.distanceFromStepMeters
    ),
  }));

  return { ...route, steps };
}
