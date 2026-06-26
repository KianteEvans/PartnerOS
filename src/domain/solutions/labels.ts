import type { SolutionType, Availability, FtrStatus } from "@/domain/solutions/operations";

/** Human labels + option lists for Solution enums, shared by the list/detail pages. */

export const SOLUTION_TYPE_LABELS: Record<SolutionType, string> = {
  software_product: "Software product",
  hardware_product: "Hardware product",
  consulting_service: "Consulting service",
  professional_service: "Professional service",
  managed_service: "Managed service",
  training_service: "Training service",
  other: "Other",
};

export const SOLUTION_TYPE_OPTIONS = Object.keys(SOLUTION_TYPE_LABELS) as SolutionType[];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: "Active (Available)",
  beta: "Beta",
  unsupported: "Unsupported",
};

export const AVAILABILITY_OPTIONS = Object.keys(AVAILABILITY_LABELS) as Availability[];

export const FTR_STATUS_LABELS: Record<FtrStatus, string> = {
  none: "Not started",
  requested: "Requested",
  approved: "Approved",
};

export const FTR_STATUS_OPTIONS = Object.keys(FTR_STATUS_LABELS) as FtrStatus[];

/** Program-type vocabulary a Solution can be validated for (drives renewal tier rule). */
export const PROGRAM_TYPE_OPTIONS: readonly string[] = [
  "Competency",
  "Service Delivery",
  "Service Ready",
  "MSP",
  "Specialization",
];

export function solutionTypeLabel(v: string): string {
  return (SOLUTION_TYPE_LABELS as Record<string, string>)[v] ?? v;
}

export function availabilityLabel(v: string): string {
  return (AVAILABILITY_LABELS as Record<string, string>)[v] ?? v;
}

export function ftrStatusLabel(v: string): string {
  return (FTR_STATUS_LABELS as Record<string, string>)[v] ?? v;
}
