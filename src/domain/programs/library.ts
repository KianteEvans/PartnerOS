/**
 * The static, source-backed Program Library: the AWS programs PartnerOS knows
 * how to track and their requirement checklists. Code-versioned (not tenant
 * data), so it ships with the deployment and is trivially unit-testable. When a
 * tenant adopts a program, these requirements are snapshotted into
 * program_requirements rows.
 */

export type EvidenceTypeKey =
  | "case_study"
  | "certification"
  | "architecture"
  | "security"
  | "billing"
  | "reference"
  | "other";

export interface LibraryRequirement {
  readonly key: string;
  readonly label: string;
  readonly expectedEvidenceType: EvidenceTypeKey;
}

export interface LibraryProgram {
  readonly key: string;
  readonly name: string;
  readonly programType: string;
  readonly deliveryModel: string;
  readonly fundingFit: string;
  readonly description: string;
  readonly requirements: readonly LibraryRequirement[];
}

export const PROGRAM_LIBRARY: readonly LibraryProgram[] = [
  {
    key: "migration_competency",
    name: "Migration Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "high",
    description:
      "Validates proven success delivering AWS migrations, with public references and a technical review.",
    requirements: [
      { key: "customer_references", label: "Public customer references", expectedEvidenceType: "case_study" },
      { key: "technical_validation", label: "Technical / architecture validation", expectedEvidenceType: "architecture" },
      { key: "certified_staff", label: "Certified staff headcount", expectedEvidenceType: "certification" },
      { key: "self_assessment", label: "Completed self-assessment workbook", expectedEvidenceType: "reference" },
    ],
  },
  {
    key: "isv_accelerate",
    name: "ISV Accelerate",
    programType: "Program",
    deliveryModel: "Software",
    fundingFit: "medium",
    description:
      "Co-sell program for ISVs with a Marketplace presence and validated product.",
    requirements: [
      { key: "marketplace_listing", label: "AWS Marketplace listing live", expectedEvidenceType: "billing" },
      { key: "product_validation", label: "Foundational technical review", expectedEvidenceType: "architecture" },
      { key: "references", label: "Customer references", expectedEvidenceType: "case_study" },
    ],
  },
  {
    key: "security_competency",
    name: "Security Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "high",
    description:
      "Recognizes deep expertise securing AWS workloads across one or more security categories.",
    requirements: [
      { key: "security_case_studies", label: "Security customer case studies", expectedEvidenceType: "case_study" },
      { key: "security_validation", label: "Security control documentation", expectedEvidenceType: "security" },
      { key: "certified_security_staff", label: "Security-certified staff", expectedEvidenceType: "certification" },
    ],
  },
  {
    key: "advanced_tier",
    name: "Advanced Tier",
    programType: "Tier",
    deliveryModel: "Any",
    fundingFit: "medium",
    description:
      "Partner tier advancement based on launched opportunities, certifications, and customer satisfaction.",
    requirements: [
      { key: "launched_opportunities", label: "Launched opportunity threshold", expectedEvidenceType: "reference" },
      { key: "certifications", label: "Certification count", expectedEvidenceType: "certification" },
      { key: "customer_satisfaction", label: "Customer satisfaction evidence", expectedEvidenceType: "reference" },
    ],
  },
  {
    key: "devops_competency",
    name: "DevOps Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "high",
    description:
      "Validates proven expertise delivering CI/CD, IaC, and observability outcomes on AWS.",
    requirements: [
      { key: "devops_case_studies", label: "Public DevOps customer references", expectedEvidenceType: "case_study" },
      { key: "cicd_validation", label: "CI/CD pipeline architecture validation", expectedEvidenceType: "architecture" },
      { key: "certified_devops_staff", label: "DevOps-certified staff", expectedEvidenceType: "certification" },
      { key: "self_assessment", label: "Completed self-assessment workbook", expectedEvidenceType: "reference" },
    ],
  },
  {
    key: "data_analytics_competency",
    name: "Data & Analytics Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "high",
    description:
      "Recognizes demonstrated success building data lakes, warehouses, and analytics platforms on AWS.",
    requirements: [
      { key: "analytics_case_studies", label: "Analytics customer case studies", expectedEvidenceType: "case_study" },
      { key: "data_platform_validation", label: "Data platform architecture review", expectedEvidenceType: "architecture" },
      { key: "certified_data_staff", label: "Data-certified staff", expectedEvidenceType: "certification" },
    ],
  },
  {
    key: "ml_competency",
    name: "Machine Learning Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "medium",
    description:
      "Validates expertise building, training, and operating ML and generative-AI workloads on AWS.",
    requirements: [
      { key: "ml_case_studies", label: "ML customer case studies", expectedEvidenceType: "case_study" },
      { key: "ml_solution_validation", label: "ML solution architecture review", expectedEvidenceType: "architecture" },
      { key: "certified_ml_staff", label: "ML-certified staff", expectedEvidenceType: "certification" },
    ],
  },
  {
    key: "networking_competency",
    name: "Networking Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "medium",
    description:
      "Recognizes deep expertise designing hybrid connectivity, edge, and software-defined networking on AWS.",
    requirements: [
      { key: "networking_case_studies", label: "Networking customer case studies", expectedEvidenceType: "case_study" },
      { key: "network_validation", label: "Network architecture validation", expectedEvidenceType: "architecture" },
      { key: "certified_network_staff", label: "Network-certified staff", expectedEvidenceType: "certification" },
    ],
  },
  {
    key: "saas_specialization",
    name: "SaaS Specialization",
    programType: "Specialization",
    deliveryModel: "Software",
    fundingFit: "medium",
    description:
      "For ISVs running a multi-tenant SaaS product on AWS with a validated Marketplace presence.",
    requirements: [
      { key: "saas_listing", label: "AWS Marketplace SaaS listing live", expectedEvidenceType: "billing" },
      { key: "saas_product_validation", label: "SaaS technical baseline review", expectedEvidenceType: "architecture" },
      { key: "saas_references", label: "SaaS customer references", expectedEvidenceType: "case_study" },
    ],
  },
  {
    key: "eks_service_delivery",
    name: "Amazon EKS Service Delivery",
    programType: "Service Delivery",
    deliveryModel: "Consulting",
    fundingFit: "medium",
    description:
      "Validates a repeatable practice delivering production Amazon EKS (Kubernetes) workloads for customers.",
    requirements: [
      { key: "eks_case_studies", label: "EKS delivery case studies", expectedEvidenceType: "case_study" },
      { key: "eks_validation", label: "EKS technical validation", expectedEvidenceType: "architecture" },
      { key: "eks_certified_staff", label: "Container-certified staff", expectedEvidenceType: "certification" },
    ],
  },
];

const BY_KEY: ReadonlyMap<string, LibraryProgram> = new Map(
  PROGRAM_LIBRARY.map((p) => [p.key, p]),
);

export function getLibraryProgram(key: string): LibraryProgram | undefined {
  return BY_KEY.get(key);
}

export const FUNDING_FIT_LABELS: Record<string, string> = {
  high: "High funding fit",
  medium: "Medium funding fit",
  low: "Low funding fit",
};
