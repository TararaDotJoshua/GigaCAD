import type { ApprovalEvaluation, CandidateError, CandidateWarning, AppliedReplacement, ManifestEntry, Picks, PickRow, ProjectRole } from '@gigacad/core';
import { ApiError, CliError, hintFor } from './errors.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Thin JSON client for the GigaCAD REST API. Errors become ApiError with the server's code. */
export class Api {
  constructor(
    readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  get signedIn(): boolean {
    return this.token !== undefined;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      throw new CliError('network', `Can't reach the GigaCAD API at ${this.baseUrl}${cause ? ` (${cause})` : ''}`, {
        hint: 'Check your connection, or set --api-url / GIGA_API_URL for a local API.',
      });
    }

    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;
    if (response.ok) return parsed as T;

    const error = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    const code = error?.code ?? (response.status === 401 ? 'unauthorized' : `http_${response.status}`);
    const message =
      code === 'unauthorized'
        ? this.token
          ? 'Your sign-in is no longer valid'
          : 'Sign in to continue'
        : (error?.message ?? `The API returned HTTP ${response.status}`);
    throw new ApiError(response.status, code, message, { hint: hintFor(code), details: error?.details });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Response shapes. Dates arrive as ISO strings.

export interface Profile {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string | null;
  readonly quotaBytes: number;
  readonly createdAt: string;
}

export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export interface DeviceGrant {
  readonly accessToken: string;
  readonly tokenId?: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerHandle: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: 'public' | 'private';
  readonly license: string | null;
  readonly role: ProjectRole | null;
  readonly latestReleaseNumber: number | null;
  readonly createdAt: string;
}

export type BranchStatus = 'open' | 'frozen' | 'released' | 'archived';

export interface BranchView {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: BranchStatus;
  readonly baseReleaseId: string | null;
  readonly baseReleaseNumber: number | null;
  readonly headCommitId: string;
  readonly checkedOutBy: string | null;
  readonly checkedOutByHandle: string | null;
  readonly checkedOutMachine: string | null;
  readonly checkedOutAt: string | null;
  readonly createdAt: string;
}

export interface CommitView {
  readonly id: string;
  readonly branchId: string;
  readonly parentId: string | null;
  readonly manifestId: string;
  readonly kind: 'autosave' | 'version';
  readonly message: string;
  readonly versionLabel: string | null;
  readonly authorHandle: string | null;
  readonly createdAt: string;
}

export interface BranchDetail {
  readonly branch: BranchView;
  readonly head: CommitView;
  readonly files: ManifestEntry[];
}

export interface CommitResult {
  readonly commit: CommitView;
  readonly files: ManifestEntry[];
  readonly created: boolean;
}

export interface UploadPlan {
  readonly present: readonly string[];
  readonly uploads: readonly {
    readonly uploadId: string;
    readonly sha256: string;
    readonly url: string;
    readonly method: 'PUT';
    readonly headers: Readonly<Record<string, string>>;
  }[];
}

export interface UploadCompletion {
  readonly completed: readonly string[];
  readonly failed: readonly { readonly uploadId: string; readonly reason: string }[];
}

export interface DownloadPlan {
  readonly downloads: readonly { readonly sha256: string; readonly url: string }[];
  readonly missing: readonly string[];
}

export interface ReleaseView {
  readonly id: string;
  readonly number: number;
  readonly manifestId: string;
  readonly notes: string;
  readonly releaseRequestId: string | null;
  readonly createdByHandle: string | null;
  readonly createdAt: string;
}

export interface ReleaseDetail {
  readonly release: ReleaseView;
  readonly files: ManifestEntry[];
}

export type ReleaseRequestStatus = 'open' | 'candidate' | 'released' | 'closed';

export interface ReleaseRequestSummary {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly status: ReleaseRequestStatus;
  readonly branchName: string;
  readonly requesterHandle: string | null;
  readonly updatedAt: string;
}

export interface ReleaseRequestDetail {
  readonly releaseRequest: {
    readonly id: string;
    readonly projectId: string;
    readonly number: number;
    readonly branchId: string;
    readonly branchName: string;
    readonly requesterId: string | null;
    readonly requesterHandle: string | null;
    readonly title: string;
    readonly body: string;
    readonly status: ReleaseRequestStatus;
    readonly picks: Picks;
    readonly candidateManifestId: string | null;
    readonly rebuildManifestId: string | null;
    readonly rebuildStatus: 'passed' | 'passed_with_warnings' | 'failed' | null;
    readonly releasedReleaseId: string | null;
    readonly updatedAt: string;
  };
  readonly latestRelease: { readonly id: string; readonly number: number } | null;
  readonly preview: {
    readonly rows: readonly PickRow[];
    readonly replacements: readonly AppliedReplacement[];
    readonly warnings: readonly CandidateWarning[];
    readonly errors: readonly CandidateError[];
    readonly ok: boolean;
  };
  readonly candidate: { readonly manifestId: string; readonly files: ManifestEntry[]; readonly upToDate: boolean } | null;
  readonly approvals: {
    readonly given: readonly { readonly userId: string; readonly handle: string; readonly candidateManifestId: string; readonly createdAt: string }[];
    readonly evaluation: ApprovalEvaluation | null;
  };
}
