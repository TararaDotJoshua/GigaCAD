import type {
  AppliedReplacement,
  ApprovalEvaluation,
  ApprovalRules,
  BillingInterval,
  CandidateError,
  CandidateWarning,
  ManifestEntry,
  PickRow,
  Picks,
  PlanId,
  ProjectRole,
} from '@gigacad/core';
import { apiUrl } from './config';

/** An error response from the GigaCAD API, with its stable `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(token: string | null, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, apiUrl()), {
      ...init,
      cache: 'no-store',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'The GigaCAD API is unreachable. Try again in a moment.');
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? `http_${response.status}`,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details,
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

// Response shapes. Dates arrive as ISO strings.

export interface Profile {
  id: string;
  handle: string;
  displayName: string | null;
  quotaBytes?: number;
  createdAt?: string;
}

export interface Billing {
  plan: PlanId;
  interval: BillingInterval | null;
  /** Stripe's subscription status, e.g. active or past_due. */
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usedBytes: number;
  quotaBytes: number;
  billingEnabled: boolean;
  canManage: boolean;
}

export interface Project {
  id: string;
  ownerId: string;
  ownerHandle: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  license: string | null;
  role: ProjectRole | null;
  latestReleaseNumber: number | null;
  starCount: number;
  starred: boolean;
  forkCount: number;
  forkedFrom: { ownerHandle: string; slug: string; releaseNumber: number } | null;
  /** A fork of a private project, which can't be made public. */
  mustStayPrivate: boolean;
  createdAt: string;
}

/** A project as Explore and profile pages list it. */
export interface ProjectCard {
  id: string;
  ownerHandle: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  license: string | null;
  createdAt: string;
  latestReleaseNumber: number | null;
  starCount: number;
  /** A short-lived link to the project's cover thumbnail, if it has one. */
  thumbnailUrl: string | null;
}

/** A STEP or STL export of a SolidWorks file, made in SolidWorks and uploaded with it. */
export interface FileExport {
  format: 'stl' | 'step';
  sha256: string;
  size: number;
}

export interface ThumbnailLinks {
  /** Short-lived image links by file content hash. */
  thumbnails: Record<string, string>;
  pending: string[];
}

export interface UserPage {
  profile: { handle: string; displayName: string | null; createdAt: string };
  projects: ProjectCard[];
}

/** A project its owner deleted that can still be restored. */
export interface DeletedProject {
  id: string;
  slug: string;
  name: string;
  ownerHandle: string;
  deletedAt: string;
  purgeAt: string;
}

export interface Member {
  userId: string;
  handle: string;
  displayName: string | null;
  role: ProjectRole;
}

export type BranchStatus = 'open' | 'frozen' | 'released' | 'archived';

export interface Branch {
  id: string;
  projectId: string;
  name: string;
  status: BranchStatus;
  baseReleaseId: string | null;
  baseReleaseNumber: number | null;
  headCommitId: string;
  checkedOutBy: string | null;
  checkedOutByHandle: string | null;
  checkedOutMachine: string | null;
  checkedOutAt: string | null;
  createdAt: string;
}

export interface Commit {
  id: string;
  branchId: string;
  parentId: string | null;
  manifestId: string;
  kind: 'autosave' | 'version';
  message: string;
  versionLabel: string | null;
  authorId: string | null;
  authorHandle: string | null;
  createdAt: string;
}

export interface BranchDetail {
  branch: Branch;
  head: Commit;
  files: ManifestEntry[];
}

export interface CommitDetail {
  commit: Commit;
  files: ManifestEntry[];
}

export interface Release {
  id: string;
  number: number;
  manifestId: string;
  notes: string;
  releaseRequestId: string | null;
  createdBy: string | null;
  createdByHandle: string | null;
  createdAt: string;
}

export interface ReleaseDetail {
  release: Release;
  files: ManifestEntry[];
}

export type ReleaseRequestStatus = 'open' | 'candidate' | 'released' | 'closed';

export interface ReleaseRequestSummary {
  id: string;
  number: number;
  title: string;
  status: ReleaseRequestStatus;
  branchName: string;
  requesterHandle: string | null;
  updatedAt: string;
}

export interface RebuildMessage {
  level: 'info' | 'warning' | 'error';
  message: string;
  path?: string;
}

export interface ReleaseRequestDetail {
  releaseRequest: {
    id: string;
    projectId: string;
    number: number;
    branchId: string;
    branchName: string;
    requesterId: string | null;
    requesterHandle: string | null;
    title: string;
    body: string;
    status: ReleaseRequestStatus;
    picks: Picks;
    targetReleaseId: string | null;
    candidateManifestId: string | null;
    rebuildManifestId: string | null;
    rebuildStatus: 'passed' | 'passed_with_warnings' | 'failed' | null;
    rebuildReport: { messages: RebuildMessage[] } | null;
    releasedReleaseId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  latestRelease: { id: string; number: number } | null;
  preview: {
    rows: PickRow[];
    replacements: AppliedReplacement[];
    warnings: CandidateWarning[];
    errors: CandidateError[];
    ok: boolean;
  };
  candidate: { manifestId: string; files: ManifestEntry[]; upToDate: boolean } | null;
  approvals: {
    given: { userId: string; handle: string; candidateManifestId: string; createdAt: string }[];
    evaluation: ApprovalEvaluation | null;
  };
}

export type { ApprovalRules };

export interface ProjectEvent {
  id: string;
  kind: string;
  actorId: string | null;
  subjectId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeviceToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
