import { DragEvent, FormEvent, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import imageCompression from "browser-image-compression";
import { uploadData } from "aws-amplify/storage";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

// Initialize the backend database service provider connection
const dataClient = generateClient<Schema>();

type UploadMode = "demo" | "amplify" | "presigned";

type Attachment = {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  url?: string;
  error?: string;
};

type FormState = {
  names: string;
  email: string;
  relation: string;
  attendance: string;
  highlight: string;
  rating: number;
  story: string;
  suggestions: string;
};

const initialForm: FormState = {
  names: "",
  email: "",
  relation: "",
  attendance: "",
  highlight: "",
  rating: 10,
  story: "",
  suggestions: "",
};

// ✅ FIXED: 5GB video limit
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

const DEFAULT_CDN_BASE_URL = "";
const AMPLIFY_APP_URL = "https://main.d3nk7hd5o95p93.amplifyapp.com";

const colors = {
  wine: "#6b0f1a",
  deepWine: "#4b0c14",
  champagne: "#f5e6c8",
  gold: "#d4af37",
  silver: "#c0c0c0",
};

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

function buildReadableFileUrl(baseUrl: string, filename: string) {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) return undefined;
  return `${trimmedBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(filename)}`;
}

export default function App() {
  const [activePage, setActivePage] = useState<"upload" | "gallery" | "admin">("upload");
  const [galleryTab, setGalleryTab] = useState<"photos" | "videos" | "downloads">("photos");
  const [form, setForm] = useState<FormState>(initialForm);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadMode, setUploadMode] = useState<UploadMode>("amplify");
  const [uploadEndpoint, setUploadEndpoint] = useState("");
  const [cdnBase, setCdnBase] = useState(DEFAULT_CDN_BASE_URL);
  const [shareUrl, setShareUrl] = useState(AMPLIFY_APP_URL);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Ready for your love notes and memories."
  );

  // ✅ NEW: Failed upload warning state
  const [failedFiles, setFailedFiles] = useState<string[]>([]);
  const [showQR, setShowQR] = useState(false);

  // ✅ NEW: Admin Dashboard state
  const [adminPassword, setAdminPassword] = useState("");
  const [adminInput, setAdminInput] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [guestEntries, setGuestEntries] = useState<any[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    const totalBytes = attachments.reduce((sum, a) => sum + a.file.size, 0);
    const imageCount = attachments.filter((a) =>
      a.file.type.startsWith("image")
    ).length;
    const videoCount = attachments.filter((a) =>
      a.file.type.startsWith("video")
    ).length;
    const done = attachments.filter((a) => a.status === "done").length;
    const errors = attachments.filter((a) => a.status === "error").length;
    return { totalBytes, imageCount, videoCount, done, errors };
  }, [attachments]);

  const handleFieldChange = <K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addFiles = (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    const next = list.map((file) => ({
      id: randomId(),
      file,
      preview: URL.createObjectURL(file),
      status: "pending" as const,
      progress: 0,
    }));
    setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      prev
        .filter((a) => a.id === id)
        .forEach((a) => {
          if (a.preview) URL.revokeObjectURL(a.preview);
        });
      return prev.filter((a) => a.id !== id);
    });
  };

  const updateAttachment = (
    id: string,
    updater: (attachment: Attachment) => Attachment
  ) => {
    setAttachments((prev) =>
      prev.map((att) => (att.id === id ? updater(att) : att))
    );
  };

  const uploadAttachment = async (
    attachment: Attachment,
    strategy: UploadMode,
    uniqueStorageKey: string
  ): Promise<boolean> => {
    updateAttachment(attachment.id, (att) => ({
      ...att,
      status: "uploading",
      progress: 5,
      error: undefined,
    }));

    // ─── 1. DEMO MOCK STRATEGY ──────────────────────────────────────
    if (strategy === "demo") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      updateAttachment(attachment.id, (att) => ({ ...att, progress: 72 }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      updateAttachment(attachment.id, (att) => ({
        ...att,
        status: "done",
        progress: 100,
        url:
          buildReadableFileUrl(cdnBase, `media/${attachment.file.name}`) ||
          att.preview,
      }));
      return true;
    }

    // ─── 2. REAL AMPLIFY PRODUCTION STRATEGY ────────────────────────
    if (strategy === "amplify") {
      try {
        let payload: File | Blob = attachment.file;

        // ✅ Optimize images before upload
        if (attachment.file.type.startsWith("image/")) {
          const compressionOptions = {
            maxSizeMB: 1.5,
            maxWidthOrHeight: 2560,
            useWebWorker: true,
            initialQuality: 0.85,
          };
          updateAttachment(attachment.id, (att) => ({
            ...att,
            error: "Optimizing image quality...",
          }));
          payload = await imageCompression(attachment.file, compressionOptions);
          updateAttachment(attachment.id, (att) => ({
            ...att,
            error: undefined,
          }));
        }

        // ✅ FIXED: 5GB video limit.
        if (attachment.file.type.startsWith("video/")) {
          if (attachment.file.size > MAX_VIDEO_BYTES) {
            throw new Error(
              `Video is ${formatBytes(
                attachment.file.size
              )}. Maximum allowed is 5GB. Please shorten or compress your clip.`
            );
          }
        }

        // ✅ FIXED: Removed useAccelerateEndpoint
        const uploadTask = uploadData({
          path: `media/${uniqueStorageKey}`,
          data: payload,
          options: {
            contentType: attachment.file.type,
            onProgress: ({ transferredBytes, totalBytes }) => {
              if (totalBytes) {
                const percentage = (transferredBytes / totalBytes) * 100;
                updateAttachment(attachment.id, (att) => ({
                  ...att,
                  progress: percentage,
                }));
              }
            },
          },
        });

        await uploadTask.result;

        updateAttachment(attachment.id, (att) => ({
          ...att,
          status: "done",
          progress: 100,
          url: att.preview,
          error: undefined,
        }));

        return true;
      } catch (err: any) {
        console.error("Amplify S3 Error:", err);
        updateAttachment(attachment.id, (att) => ({
          ...att,
          status: "error",
          error: err.message || "Upload failed. Please try again.",
        }));
        return false;
      }
    }

    // ─── 3. PRESIGNED ENDPOINT STRATEGY ─────────────────────────────
    try {
      if (!uploadEndpoint.trim()) {
        throw new Error(
          "Add a pre-sign endpoint before using pre-signed uploads."
        );
      }

      const presign = await fetch(uploadEndpoint.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: attachment.file.name,
          contentType: attachment.file.type,
          size: attachment.file.size,
        }),
      });

      if (!presign.ok) throw new Error(`Presign failed (${presign.status})`);

      const data: {
        uploadUrl: string;
        fileUrl?: string;
        fields?: Record<string, string>;
      } = await presign.json();

      updateAttachment(attachment.id, (att) => ({ ...att, progress: 45 }));

      if (data.fields) {
        const formData = new FormData();
        Object.entries(data.fields).forEach(([k, v]) => formData.append(k, v));
        formData.append("file", attachment.file);
        const uploadRes = await fetch(data.uploadUrl, {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok)
          throw new Error(`Upload failed (${uploadRes.status})`);
      } else {
        const uploadRes = await fetch(data.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type":
              attachment.file.type || "application/octet-stream",
          },
          body: attachment.file,
        });
        if (!uploadRes.ok)
          throw new Error(`Upload failed (${uploadRes.status})`);
      }

      const publicUrl =
        data.fileUrl || buildReadableFileUrl(cdnBase, attachment.file.name);

      updateAttachment(attachment.id, (att) => ({
        ...att,
        status: "done",
        progress: 100,
        url: publicUrl,
        error: publicUrl
          ? undefined
          : "Upload succeeded, but no file URL was returned.",
      }));

      return true;
    } catch (error) {
      console.error(error);
      updateAttachment(attachment.id, (att) => ({
        ...att,
        status: "error",
        error:
          error instanceof Error ? error.message : "Upload failed",
      }));
      return false;
    }
  };

  // ✅ FIXED: Full handleSubmit with failed upload warnings
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFailedFiles([]);
    setStatusMessage("Uploading files and saving your words...");

    const uploadedKeys: string[] = [];
    const failedNames: string[] = [];

    // Loop and fire files up to S3
    for (const att of attachments) {
      if (att.status === "done") {
        // Already uploaded - keep track
        const existingKey = `${att.file.name}`;
        uploadedKeys.push(existingKey);
        continue;
      }

      const uniqueKey = `${Date.now()}-${att.file.name.replace(
        /[^a-zA-Z0-9.-]/g,
        "_"
      )}`;
      const isSuccess = await uploadAttachment(att, uploadMode, uniqueKey);

      if (isSuccess) {
        uploadedKeys.push(uniqueKey);
      } else {
        // ✅ Track failed uploads by file name
        failedNames.push(att.file.name);
      }
    }

    // ✅ Show failed upload warning if any files failed
    if (failedNames.length > 0) {
      setFailedFiles(failedNames);
      setStatusMessage(
        `⚠️ ${failedNames.length} file(s) failed to upload. Your message was still saved.`
      );
    }

    // ✅ Only save to DB if form is valid and has something to save
    if (uploadedKeys.length > 0 || form.story) {
      try {
        await dataClient.models.GuestEntry.create({
          names: form.names,
          email: form.email || undefined,
          relation: form.relation,
          attendance: form.attendance,
          highlight: form.highlight || undefined,
          rating: form.rating,
          story: form.story,
          suggestions: form.suggestions || undefined,
          mediaKeys: uploadedKeys,
        });

        if (failedNames.length === 0) {
          setStatusMessage(
            "💕 Thanks for sharing the love! Your memories are secured safely."
          );
        }

        setForm(initialForm);
        setAttachments([]);
      } catch (dbError) {
        console.error("Database Error:", dbError);
        setStatusMessage(
          "Files uploaded ✅ but failed to save your feedback. Please try again."
        );
      }
    }

    setSubmitting(false);
  };

  // ✅ NEW: Load all guest entries for admin
  const loadGuestEntries = async () => {
    setLoadingEntries(true);
    try {
      const { data: entries } = await dataClient.models.GuestEntry.list();
      setGuestEntries(entries || []);
    } catch (error) {
      console.error("Failed to load entries:", error);
      alert("Failed to load guest entries");
    } finally {
      setLoadingEntries(false);
    }
  };

  // ✅ NEW: Admin authentication
  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Simple password check (change "wedding2024" to your desired password)
    if (adminInput === "dolan26") {
      setAdminAuthed(true);
      setAdminInput("");
      loadGuestEntries();
    } else {
      alert("❌ Incorrect password");
      setAdminInput("");
    }
  };

  const dropHandlers = {
    onDragOver: (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    },
  };

  // ✅ ADMIN DASHBOARD PAGE
  if (activePage === "admin") {
    return (
      <div
        className="min-h-screen bg-slate-900 text-white"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(75,12,20,0.88), rgba(26,23,23,0.78))",
          backgroundSize: "cover",
        }}
      >
        <div className="backdrop-blur-[2px] px-4 py-10">
          <div className="mx-auto max-w-7xl">
            {!adminAuthed ? (
              // ✅ Admin Login Form
              <div className="mx-auto max-w-md">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl">
                  <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">🔐 Admin Access</h1>
                    <p className="text-white/70">Enter password to view all submissions</p>
                  </div>

                  <form onSubmit={handleAdminLogin} className="space-y-4">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#f5e6c8]">
                        Password
                      </span>
                      <input
                        type="password"
                        value={adminInput}
                        onChange={(e) => setAdminInput(e.target.value)}
                        placeholder="Enter admin password"
                        className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                      />
                    </label>
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-gradient-to-r from-[#6b0f1a] to-[#4b0c14] px-4 py-3 font-semibold text-white shadow-lg transition hover:-translate-y-[1px]"
                    >
                      Unlock Dashboard
                    </button>
                  </form>

                  <button
                    type="button"
                    onClick={() => setActivePage("upload")}
                    className="mt-4 w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    ← Back
                  </button>
                </div>
              </div>
            ) : (
              // ✅ Admin Dashboard Content
              <div className="space-y-6">
                <header className="rounded-3xl border border-white/10 bg-white/10 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">
                        Admin Panel
                      </p>
                      <h1 className="text-3xl font-semibold text-white">
                        Guest Submissions
                      </h1>
                      <p className="mt-1 text-sm text-white/70">
                        Total: {guestEntries.length} submissions
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={loadGuestEntries}
                        className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
                      >
                        🔄 Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAdminAuthed(false);
                          setGuestEntries([]);
                        }}
                        className="rounded-xl bg-rose-600/20 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-600/30"
                      >
                        Logout
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePage("upload")}
                        className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        ← Back
                      </button>
                    </div>
                  </div>
                </header>

                {loadingEntries ? (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center">
                    <div className="inline-block">
                      <svg
                        className="h-12 w-12 animate-spin text-[#d4af37]"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8z"
                        />
                      </svg>
                    </div>
                    <p className="mt-4 text-white/70">Loading submissions...</p>
                  </div>
                ) : guestEntries.length === 0 ? (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center">
                    <p className="text-lg text-white/70">📭 No guest submissions yet</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {guestEntries.map((entry, idx) => (
                      <div
                        key={entry.id || idx}
                        className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-sm"
                      >
                        {/* Header */}
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="text-xl font-bold text-white">
                              {entry.names}
                            </h3>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs">
                              <span className="rounded-full bg-[#d4af37]/20 px-3 py-1 text-[#d4af37] font-semibold">
                                {entry.relation}
                              </span>
                              <span className="rounded-full bg-white/10 px-3 py-1 text-white">
                                {entry.attendance}
                              </span>
                              <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-yellow-300 font-semibold">
                                ⭐ {entry.rating}/10
                              </span>
                            </div>
                          </div>
                          {entry.email && (
                            <a
                              href={`mailto:${entry.email}`}
                              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-[#d4af37] hover:bg-white/20"
                            >
                              📧 {entry.email}
                            </a>
                          )}
                        </div>

                        {/* Content */}
                        <div className="space-y-3 border-t border-white/10 pt-4">
                          {entry.highlight && (
                            <div>
                              <p className="text-xs font-semibold text-[#f5e6c8] uppercase">
                                Favorite Moment
                              </p>
                              <p className="mt-1 text-sm text-white/90">
                                {entry.highlight}
                              </p>
                            </div>
                          )}

                          {entry.story && (
                            <div>
                              <p className="text-xs font-semibold text-[#f5e6c8] uppercase">
                                Their Story
                              </p>
                              <p className="mt-1 text-sm text-white/90 max-h-32 overflow-y-auto">
                                {entry.story}
                              </p>
                            </div>
                          )}

                          {entry.suggestions && (
                            <div>
                              <p className="text-xs font-semibold text-[#f5e6c8] uppercase">
                                Suggestions
                              </p>
                              <p className="mt-1 text-sm text-white/90">
                                {entry.suggestions}
                              </p>
                            </div>
                          )}

                          {entry.mediaKeys && entry.mediaKeys.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-[#f5e6c8] uppercase">
                                📁 Files ({entry.mediaKeys.length})
                              </p>
                              <ul className="mt-2 space-y-1">
                                {entry.mediaKeys.map((key: string, i: number) => (
                                  <li
                                    key={i}
                                    className="text-xs text-white/70 truncate"
                                  >
                                    • {key}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {/* Footer */}
                        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-white/50">
                          <span>ID: {entry.id}</span>
                          <span>
                            {entry.createdAt
                              ? new Date(entry.createdAt).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "Date unknown"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-900 text-white"
      style={{
        backgroundImage:
          "linear-gradient(135deg, rgba(75,12,20,0.88), rgba(26,23,23,0.78)), url('/images/wedding-bg.jpg')",
        backgroundSize: "cover, cover",
        backgroundPosition: "center, center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="backdrop-blur-[2px] px-4 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-8">

          {/* ── HEADER ── */}
          <header className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl shadow-black/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Logo icon */}
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg"
                  style={{
                    background: `linear-gradient(135deg, ${colors.wine}, ${colors.gold})`,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-6 w-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M12 21s-6-4.35-9-9a5.4 5.4 0 1 1 9-6 5.4 5.4 0 1 1 9 6c-3 4.65-9 9-9 9Z" />
                  </svg>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">
                    Wedding Memory Box
                  </p>
                  <h1 className="text-3xl font-semibold text-white">
                    Feedback & Memory Upload Portal
                  </h1>
                  <p className="text-sm text-white/70">
                    Wine + champagne gold palette · QR-friendly · Unlimited
                    uploads
                  </p>

                  {/* Nav tabs */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActivePage("upload")}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        activePage === "upload"
                          ? "bg-white text-[#6b0f1a]"
                          : "bg-white/15 text-white hover:bg-white/25"
                      }`}
                    >
                      Landing page
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePage("gallery")}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        activePage === "gallery"
                          ? "bg-white text-[#6b0f1a]"
                          : "bg-white/15 text-white hover:bg-white/25"
                      }`}
                    >
                      Uploads & downloads
                    </button>

                    {/* ✅ NEW: Admin Dashboard button */}
                    <button
                      type="button"
                      onClick={() => setActivePage("admin")}
                      className="rounded-full bg-yellow-500/20 px-4 py-2 text-sm font-semibold text-yellow-300 transition hover:bg-yellow-500/30"
                    >
                      🔐 Admin
                    </button>

                    {/* ✅ QR Code toggle button */}
                    <button
                      type="button"
                      onClick={() => setShowQR((v) => !v)}
                      className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
                    >
                      {showQR ? "Hide QR Code" : "📱 Show QR Code"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Stats cards */}
              <div className="flex gap-3 text-slate-900">
                <div className="rounded-2xl bg-white/90 px-4 py-3 text-right shadow ring-1 ring-white/40">
                  <p className="text-xs text-slate-600">Total selected</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {attachments.length || "0"} files
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(stats.totalBytes)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/90 px-4 py-3 text-right shadow ring-1 ring-white/40">
                  <p className="text-xs text-slate-600">Status</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {stats.done} uploaded
                  </p>
                  {/* ✅ Show error count if any */}
                  {stats.errors > 0 && (
                    <p className="text-xs font-semibold text-rose-600">
                      {stats.errors} failed
                    </p>
                  )}
                  <p
                    className="text-xs font-semibold p-1 max-w-[180px] break-words"
                    style={{ color: colors.wine }}
                  >
                    {statusMessage}
                  </p>
                </div>
              </div>
            </div>

            {/* ✅ QR Code Panel */}
            {showQR && (
              <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-5">
                <p className="text-sm font-semibold text-[#f5e6c8]">
                  📱 Scan to open the upload portal
                </p>
                <div className="rounded-2xl bg-white p-3 shadow-lg">
                  <QRCodeCanvas
                    value={shareUrl}
                    size={160}
                    bgColor="#ffffff"
                    fgColor={colors.wine}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <div className="flex items-center gap-2 w-full max-w-sm">
                  <input
                    type="text"
                    value={shareUrl}
                    onChange={(e) => setShareUrl(e.target.value)}
                    className="flex-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder-white/50 focus:outline-none focus:ring-1 focus:ring-[#d4af37]"
                    placeholder="Custom URL for QR code"
                  />
                </div>
                <p className="text-xs text-white/50 text-center">
                  Share this URL or QR code with guests so they can upload
                  photos & videos
                </p>
              </div>
            )}

            {/* ✅ Failed upload warning banner */}
            {failedFiles.length > 0 && (
              <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-900/30 p-4">
                <p className="text-sm font-semibold text-rose-300">
                  ⚠️ The following files failed to upload:
                </p>
                <ul className="mt-2 space-y-1">
                  {failedFiles.map((name) => (
                    <li key={name} className="text-xs text-rose-200">
                      • {name}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-rose-300/70">
                  Your message was saved. Please try re-uploading these files.
                </p>
                <button
                  type="button"
                  onClick={() => setFailedFiles([])}
                  className="mt-2 text-xs font-semibold text-rose-300 underline"
                >
                  Dismiss
                </button>
              </div>
            )}
          </header>

          {/* ── UPLOAD PAGE ── */}
          {activePage === "upload" ? (
            <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">

              {/* Sidebar */}
              <aside className="flex flex-col gap-4">
                <div className="rounded-3xl border border-white/15 bg-white/10 p-5 shadow-xl shadow-black/30 text-white/90">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">
                    Gallery
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    See uploaded photos and videos
                  </h2>
                  <p className="mt-2 text-sm text-white/75">
                    Open the gallery page to preview selected memories and use
                    the downloads tab for file links.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActivePage("gallery")}
                    className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#6b0f1a] shadow transition hover:-translate-y-[1px]"
                  >
                    View gallery & downloads
                  </button>
                </div>

                {/* Upload mode selector */}
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-xs text-white/60 space-y-2">
                  <p className="font-semibold text-white">
                    Upload Strategy Engine:
                  </p>
                  <select
                    value={uploadMode}
                    onChange={(e) =>
                      setUploadMode(e.target.value as UploadMode)
                    }
                    className="w-full bg-slate-800 border border-white/20 p-2 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#d4af37]"
                  >
                    <option value="amplify">
                      Production (Amplify S3 Client)
                    </option>
                    <option value="demo">Local Simulation Demo Mode</option>
                  </select>
                </div>

                {/* Inline QR code in sidebar (always visible) */}
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-col items-center gap-3">
                  <p className="text-xs font-semibold text-[#f5e6c8] uppercase tracking-widest">
                    Share with Guests
                  </p>
                  <div className="rounded-2xl bg-white p-2 shadow">
                    <QRCodeCanvas
                      value={shareUrl}
                      size={120}
                      bgColor="#ffffff"
                      fgColor={colors.wine}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <p className="text-xs text-white/50 text-center">
                    Guests scan this to upload photos & videos
                  </p>
                </div>
              </aside>

              {/* Main form */}
              <main className="space-y-4 rounded-3xl border border-white/15 bg-white/90 p-6 text-slate-900 shadow-2xl shadow-black/40">
                <form onSubmit={handleSubmit} className="space-y-8">

                  {/* Names + Email */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#6b0f1a]">
                        Your names
                      </span>
                      <input
                        required
                        value={form.names}
                        onChange={(e) =>
                          handleFieldChange("names", e.target.value)
                        }
                        placeholder="Dolapo & Olanrewaju"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#6b0f1a]">
                        Email (optional)
                      </span>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) =>
                          handleFieldChange("email", e.target.value)
                        }
                        placeholder="you@email.com"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                      />
                    </label>
                  </div>

                  {/* Relation + Attendance + Rating */}
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#6b0f1a]">
                        Relation to couple
                      </span>
                      <input
                        required
                        value={form.relation}
                        onChange={(e) =>
                          handleFieldChange("relation", e.target.value)
                        }
                        placeholder="College friend, family..."
                        className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#6b0f1a]">
                        Were you there?
                      </span>
                      <select
                        required
                        value={form.attendance}
                        onChange={(e) =>
                          handleFieldChange("attendance", e.target.value)
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                      >
                        <option value="">Select an option</option>
                        <option value="In person">In person</option>
                        <option value="Joined online">Joined online</option>
                        <option value="Sending love from afar">
                          Sending love from afar
                        </option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#6b0f1a]">
                        Vibes rating
                      </span>
                      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <input
                          type="range"
                          min={1}
                          max={10}
                          value={form.rating}
                          onChange={(e) =>
                            handleFieldChange("rating", Number(e.target.value))
                          }
                          className="flex-1 accent-[#6b0f1a]"
                        />
                        <span className="w-10 text-center text-sm font-semibold text-[#6b0f1a]">
                          {form.rating}/10
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Favourite moment */}
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">
                      Favorite moment
                    </span>
                    <input
                      value={form.highlight}
                      onChange={(e) =>
                        handleFieldChange("highlight", e.target.value)
                      }
                      placeholder="The vows, the dance floor, the speeches..."
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>

                  {/* Story */}
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">
                      Share your story
                    </span>
                    <textarea
                      required
                      value={form.story}
                      onChange={(e) =>
                        handleFieldChange("story", e.target.value)
                      }
                      rows={4}
                      placeholder="Tell the couple how the day felt for you..."
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>

                  {/* Suggestions */}
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">
                      Any wishes or suggestions?
                    </span>
                    <textarea
                      value={form.suggestions}
                      onChange={(e) =>
                        handleFieldChange("suggestions", e.target.value)
                      }
                      rows={3}
                      placeholder="Future honeymoon tips, playlists, travel recs..."
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>

                  {/* File upload section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[#6b0f1a]">
                          Photos & Videos
                        </p>
                        <p className="text-xs text-slate-600">
                          Drop files here. Images unlimited · Videos up to 5GB.
                        </p>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>
                          {stats.imageCount} images • {stats.videoCount} videos
                        </p>
                        <p>{formatBytes(stats.totalBytes)}</p>
                      </div>
                    </div>

                    {/* Drop zone */}
                    <label
                      {...dropHandlers}
                      htmlFor="files"
                      className="group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#d4af37]/60 bg-[#f5e6c8]/60 px-5 py-6 text-center transition hover:-translate-y-[1px] hover:border-[#6b0f1a] hover:bg-[#f5e6c8]"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#6b0f1a] shadow">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-6 w-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M12 5v14" />
                          <path d="m5 12 7-7 7 7" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-[#4b0c14]">
                        Drag & drop or click to choose
                      </p>
                      <p className="text-xs text-[#6b0f1a]/70">
                        Images (any size) • Videos (up to 5GB)
                      </p>
                      <input
                        id="files"
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) addFiles(e.target.files);
                          if (e.target) e.target.value = "";
                        }}
                      />
                    </label>

                    {/* Attachment list */}
                    {attachments.length > 0 && (
                      <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                        {attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex flex-col gap-2 rounded-xl bg-white px-3 py-3 shadow-sm ring-1 ring-slate-100 md:flex-row md:items-center"
                          >
                            {/* File icon */}
                            <div className="flex items-center gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                                {att.file.type.startsWith("image") ? (
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-6 w-6"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <rect
                                      x="3"
                                      y="3"
                                      width="18"
                                      height="18"
                                      rx="2"
                                    />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <path d="m21 15-5-5L5 21" />
                                  </svg>
                                ) : (
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-6 w-6"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <rect
                                      x="3"
                                      y="3"
                                      width="18"
                                      height="18"
                                      rx="2"
                                    />
                                    <path d="M10 8l6 4-6 4V8Z" />
                                  </svg>
                                )}
                              </div>
                              <div className="max-w-[150px]">
                                <p className="text-sm font-semibold text-slate-800 truncate">
                                  {att.file.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {formatBytes(att.file.size)}
                                </p>
                              </div>
                            </div>

                            {/* Progress */}
                            <div className="flex flex-1 flex-col gap-2">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span
                                  className={
                                    att.status === "done"
                                      ? "text-emerald-600"
                                      : att.status === "error"
                                      ? "text-rose-600"
                                      : "text-slate-600"
                                  }
                                >
                                  {att.status === "pending" && "Pending"}
                                  {att.status === "uploading" && "Uploading..."}
                                  {att.status === "done" && "✅ Uploaded"}
                                  {att.status === "error" && "❌ Failed"}
                                </span>
                                <span className="text-slate-500">
                                  {Math.round(att.progress)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-100">
                                <div
                                  className={`h-2 rounded-full transition-all ${
                                    att.status === "error"
                                      ? "bg-rose-500"
                                      : att.status === "done"
                                      ? "bg-emerald-500"
                                      : "bg-[#6b0f1a]"
                                  }`}
                                  style={{
                                    width: `${Math.min(att.progress, 100)}%`,
                                  }}
                                />
                              </div>
                              {att.url && att.status === "done" && (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-semibold text-[#6b0f1a] hover:underline"
                                >
                                  View local preview ↗
                                </a>
                              )}
                              {/* Error shown under progress bar */}
                              {att.error && att.status !== "done" && (
                                <p className="text-xs font-semibold text-amber-600">
                                  ⚠️ {att.error}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => removeAttachment(att.id)}
                              className="text-xs font-semibold text-slate-500 underline-offset-4 hover:text-rose-600 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Submit bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#f5e6c8] via-white to-[#c0c0c0]/60 px-4 py-4 text-sm text-slate-800 shadow-inner">
                    <div className="flex flex-wrap gap-2 text-xs font-semibold text-[#4b0c14]">
                      <span className="rounded-full bg-[#722F37] px-5 py-2 text-[#F7E7CE] ring-2 ring-[#F7E7CE]">
                        Thank You!
                      </span>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        background: `linear-gradient(135deg, ${colors.wine}, ${colors.deepWine})`,
                      }}
                    >
                      {submitting ? (
                        <>
                          <svg
                            className="h-4 w-4 animate-spin"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8v8z"
                            />
                          </svg>
                          Processing...
                        </>
                      ) : (
                        <>
                          Send love & upload
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M5 12h14" />
                            <path d="m12 5 7 7-7 7" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </main>
            </div>

          ) : (

          /* ── GALLERY PAGE ── */
            <main className="rounded-3xl border border-white/15 bg-white/90 p-6 text-slate-900 shadow-2xl shadow-black/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#6b0f1a]">
                    Uploaded memories
                  </p>
                  <h2 className="text-3xl font-semibold text-slate-900">
                    Photos, videos & downloads
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePage("upload")}
                  className="rounded-xl bg-[#6b0f1a] px-4 py-2 text-sm font-semibold text-white shadow"
                >
                  ← Back to upload
                </button>
              </div>

              {/* Gallery tabs */}
              <div className="mt-6 flex flex-wrap gap-2">
                {(["photos", "videos", "downloads"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setGalleryTab(tab)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${
                      galleryTab === tab
                        ? "bg-[#6b0f1a] text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {tab === "photos" && `📷 Photos (${stats.imageCount})`}
                    {tab === "videos" && `🎥 Videos (${stats.videoCount})`}
                    {tab === "downloads" && `⬇️ Downloads (${attachments.length})`}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                {galleryTab !== "downloads" ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {attachments
                      .filter((att) =>
                        galleryTab === "photos"
                          ? att.file.type.startsWith("image")
                          : att.file.type.startsWith("video")
                      )
                      .map((att) => (
                        <article
                          key={att.id}
                          className="overflow-hidden rounded-2xl bg-white shadow ring-1 ring-slate-100"
                        >
                          {att.file.type.startsWith("image") ? (
                            <img
                              src={att.preview}
                              alt={att.file.name}
                              className="h-56 w-full object-cover"
                            />
                          ) : (
                            <video
                              src={att.preview}
                              controls
                              className="h-56 w-full bg-black object-contain"
                            />
                          )}
                          <div className="p-3">
                            <p className="truncate text-sm font-semibold text-slate-800">
                              {att.file.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatBytes(att.file.size)} ·{" "}
                              <span
                                className={
                                  att.status === "done"
                                    ? "text-emerald-600 font-semibold"
                                    : att.status === "error"
                                    ? "text-rose-600 font-semibold"
                                    : "text-slate-500"
                                }
                              >
                                {att.status}
                              </span>
                            </p>
                          </div>
                        </article>
                      ))}
                    {attachments.filter((att) =>
                      galleryTab === "photos"
                        ? att.file.type.startsWith("image")
                        : att.file.type.startsWith("video")
                    ).length === 0 && (
                      <p className="col-span-3 rounded-2xl bg-white p-5 text-sm text-slate-600 shadow text-center">
                        No {galleryTab} selected yet. Add files from the
                        landing page.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.url || att.preview}
                        download={att.file.name}
                        className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm shadow ring-1 ring-slate-100 hover:ring-[#d4af37] transition"
                      >
                        <span>
                          <strong className="text-slate-900">
                            {att.file.name}
                          </strong>
                          <br />
                          <span className="text-xs text-slate-500">
                            {formatBytes(att.file.size)} ·{" "}
                            {att.file.type || "file"} ·{" "}
                            <span
                              className={
                                att.status === "done"
                                  ? "text-emerald-600 font-semibold"
                                  : att.status === "error"
                                  ? "text-rose-600 font-semibold"
                                  : "text-slate-500"
                              }
                            >
                              {att.status}
                            </span>
                          </span>
                        </span>
                        <span className="rounded-full bg-[#f5e6c8] px-3 py-1 font-semibold text-[#6b0f1a] whitespace-nowrap">
                          ⬇️ Download
                        </span>
                      </a>
                    ))}
                    {attachments.length === 0 && (
                      <p className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow text-center">
                        No downloads yet. Add files from the landing page.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}