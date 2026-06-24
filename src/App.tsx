import { DragEvent, FormEvent, useMemo, useRef, useState } from "react";

type UploadMode = "demo" | "presigned";

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

const S3_PUBLIC_BASE_URL =
  "https://upload-353833416626-eu-central-1-an.s3.eu-central-1.amazonaws.com";

const colors = {
  wine: "#6b0f1a",
  deepWine: "#4b0c14",
  champagne: "#f5e6c8",
  gold: "#d4af37",
  silver: "#c0c0c0",
};

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export default function App() {
  const [activePage, setActivePage] = useState<"upload" | "gallery">("upload");
  const [galleryTab, setGalleryTab] = useState<"photos" | "videos" | "downloads">("photos");
  const [form, setForm] = useState<FormState>(initialForm);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cdnBase, setCdnBase] = useState(S3_PUBLIC_BASE_URL);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready for your love notes and memories.");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    const totalBytes = attachments.reduce((sum, a) => sum + a.file.size, 0);
    const imageCount = attachments.filter((a) => a.file.type.startsWith("image")).length;
    const videoCount = attachments.filter((a) => a.file.type.startsWith("video")).length;
    const done = attachments.filter((a) => a.status === "done").length;
    return { totalBytes, imageCount, videoCount, done };
  }, [attachments]);

  const handleFieldChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
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
    setAttachments((prev) => prev.map((att) => (att.id === id ? updater(att) : att)));
  };

  const uploadAttachment = async (attachment: Attachment, strategy: UploadMode) => {
    updateAttachment(attachment.id, (att) => ({ ...att, status: "uploading", progress: 12, error: undefined }));

    if (strategy === "demo") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      updateAttachment(attachment.id, (att) => ({ ...att, progress: 72 }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      updateAttachment(attachment.id, (att) => ({
        ...att,
        status: "done",
        progress: 100,
        url:
          cdnBase.trim() !== ""
            ? `${cdnBase.replace(/\/$/, "")}/${att.file.name}`
            : `https://demo-bucket.example/${att.file.name}`,
      }));
      return;
    }

    try {
      const presign = await fetch("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: attachment.file.name,
          contentType: attachment.file.type,
          size: attachment.file.size,
        }),
      });

      if (!presign.ok) {
        throw new Error(`Presign failed (${presign.status})`);
      }

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
        const uploadRes = await fetch(data.uploadUrl, { method: "POST", body: formData });
        if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);
      } else {
        const uploadRes = await fetch(data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": attachment.file.type || "application/octet-stream" },
          body: attachment.file,
        });
        if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);
      }

      const publicUrl =
        data.fileUrl ||
        (cdnBase.trim()
          ? `${cdnBase.replace(/\/$/, "")}/${attachment.file.name}`
          : data.uploadUrl?.split("?")[0]);

      updateAttachment(attachment.id, (att) => ({
        ...att,
        status: "done",
        progress: 100,
        url: publicUrl,
      }));
    } catch (error) {
      console.error(error);
      updateAttachment(attachment.id, (att) => ({
        ...att,
        status: "error",
        error: error instanceof Error ? error.message : "Upload failed",
      }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatusMessage("Uploading files and saving your words...");

    for (const att of attachments) {
      if (att.status === "done") continue;
      await uploadAttachment(att, "demo");
    }

    setStatusMessage("Thanks for sharing the love! Your feedback is saved locally.");
    setSubmitting(false);
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

  return (
    <div
      className="min-h-screen bg-slate-900 text-white"
      style={{
        backgroundImage: "linear-gradient(135deg, rgba(75,12,20,0.88), rgba(26,23,23,0.78)), url('/images/wedding-logo.svg'), url('/images/wedding-bg.jpg')",
        backgroundSize: "cover, min(70vw, 760px), cover",
        backgroundPosition: "center, center 7rem, center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="backdrop-blur-[2px] px-4 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-8">
          <header className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl shadow-black/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${colors.wine}, ${colors.gold})` }}
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 21s-6-4.35-9-9a5.4 5.4 0 1 1 9-6 5.4 5.4 0 1 1 9 6c-3 4.65-9 9-9 9Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">Wedding Memory Box</p>
                  <h1 className="text-3xl font-semibold text-white">Feedback & Memory Upload Portal</h1>
                  <p className="text-sm text-white/70">Wine + champagne gold palette · QR-friendly · Unlimited uploads</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setActivePage("upload")} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activePage === "upload" ? "bg-white text-[#6b0f1a]" : "bg-white/15 text-white hover:bg-white/25"}`}>Landing page</button>
                    <button type="button" onClick={() => setActivePage("gallery")} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activePage === "gallery" ? "bg-white text-[#6b0f1a]" : "bg-white/15 text-white hover:bg-white/25"}`}>Uploads & downloads</button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 text-slate-900">
                <div className="rounded-2xl bg-white/90 px-4 py-3 text-right shadow ring-1 ring-white/40">
                  <p className="text-xs text-slate-600">Total selected</p>
                  <p className="text-lg font-semibold text-slate-900">{attachments.length || "0"} files</p>
                  <p className="text-xs text-slate-500">{formatBytes(stats.totalBytes)}</p>
                </div>
                <div className="rounded-2xl bg-white/90 px-4 py-3 text-right shadow ring-1 ring-white/40">
                  <p className="text-xs text-slate-600">Status</p>
                  <p className="text-lg font-semibold text-slate-900">{stats.done} uploaded</p>
                  <p className="text-xs font-semibold" style={{ color: colors.wine }}>
                    {statusMessage}
                  </p>
                </div>
              </div>
            </div>
          </header>

          {activePage === "upload" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">
            <aside className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 shadow-xl shadow-black/30 text-white/90">
                <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">Gallery</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">See uploaded photos and videos</h2>
                <p className="mt-2 text-sm text-white/75">Open the gallery page to preview selected memories and use the downloads tab for file links.</p>
                <button
                  type="button"
                  onClick={() => setActivePage("gallery")}
                  className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#6b0f1a] shadow transition hover:-translate-y-[1px]"
                >
                  View gallery & downloads
                </button>
              </div>
            </aside>

            <main className="space-y-4 rounded-3xl border border-white/15 bg-white/90 p-6 text-slate-900 shadow-2xl shadow-black/40">
              <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">Your names</span>
                    <input
                      required
                      value={form.names}
                      onChange={(e) => handleFieldChange("names", e.target.value)}
                      placeholder="Alex & Jamie Rivera"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">Email (optional)</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => handleFieldChange("email", e.target.value)}
                      placeholder="you@email.com"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">Relation to couple</span>
                    <input
                      required
                      value={form.relation}
                      onChange={(e) => handleFieldChange("relation", e.target.value)}
                      placeholder="College friend, family, coworker..."
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">Were you there?</span>
                    <select
                      required
                      value={form.attendance}
                      onChange={(e) => handleFieldChange("attendance", e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    >
                      <option value="">Select an option</option>
                      <option value="In person">In person</option>
                      <option value="Joined online">Joined online</option>
                      <option value="Sending love from afar">Sending love from afar</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-[#6b0f1a]">Vibes rating</span>
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={form.rating}
                        onChange={(e) => handleFieldChange("rating", Number(e.target.value))}
                        className="flex-1 accent-[#6b0f1a]"
                      />
                      <span className="w-10 text-center text-sm font-semibold text-[#6b0f1a]">{form.rating}/10</span>
                    </div>
                  </label>
                </div>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-[#6b0f1a]">Favorite moment</span>
                  <input
                    value={form.highlight}
                    onChange={(e) => handleFieldChange("highlight", e.target.value)}
                    placeholder="The vows, the dance floor, the speeches..."
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-[#6b0f1a]">Share your story</span>
                  <textarea
                    required
                    value={form.story}
                    onChange={(e) => handleFieldChange("story", e.target.value)}
                    rows={4}
                    placeholder="Tell the couple how the day felt for you..."
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-[#6b0f1a]">Any wishes or suggestions?</span>
                  <textarea
                    value={form.suggestions}
                    onChange={(e) => handleFieldChange("suggestions", e.target.value)}
                    rows={3}
                    placeholder="Future honeymoon tips, playlists, travel recs..."
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-[#6b0f1a] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                  />
                </label>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[#6b0f1a]">Photos & Videos</p>
                      <p className="text-xs text-slate-600">Drop unlimited files. Images or videos are both welcome.</p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>{stats.imageCount} images • {stats.videoCount} videos</p>
                      <p>{formatBytes(stats.totalBytes)}</p>
                    </div>
                  </div>

                  <label
                    {...dropHandlers}
                    htmlFor="files"
                    className="group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#d4af37]/60 bg-[#f5e6c8]/60 px-5 py-6 text-center transition hover:-translate-y-[1px] hover:border-[#6b0f1a] hover:bg-[#f5e6c8]"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#6b0f1a] shadow">
                      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 5v14" />
                        <path d="m5 12 7-7 7 7" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-[#4b0c14]">Drag & drop or click to choose</p>
                    <p className="text-xs text-slate-600">Unlimited files · Images & videos · We keep the originals</p>
                    <div className="flex gap-2 text-xs font-semibold text-[#4b0c14]">
                      <span className="rounded-full bg-white px-3 py-1 shadow">Works with S3</span>
                      <span className="rounded-full bg-white px-3 py-1 shadow">Any storage with pre-signed URLs</span>
                    </div>
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

                  {attachments.length > 0 && (
                    <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex flex-col gap-2 rounded-xl bg-white px-3 py-3 shadow-sm ring-1 ring-slate-100 md:flex-row md:items-center"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                              {att.file.type.startsWith("image") ? (
                                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <path d="m21 15-5-5L5 21" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <path d="M10 8l6 4-6 4V8Z" />
                                </svg>
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{att.file.name}</p>
                              <p className="text-xs text-slate-500">{formatBytes(att.file.size)}</p>
                            </div>
                          </div>
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
                                {att.status === "done" && "Uploaded"}
                                {att.status === "error" && "Failed"}
                              </span>
                              <span className="text-slate-500">{Math.round(att.progress)}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100">
                              <div
                                className={`h-2 rounded-full transition-all ${att.status === "error" ? "bg-rose-500" : "bg-[#6b0f1a]"}`}
                                style={{ width: `${Math.min(att.progress, 100)}%` }}
                              />
                            </div>
                            {att.url && (
                              <a
                                href={att.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-semibold text-[#6b0f1a] hover:underline"
                              >
                                View file URL
                              </a>
                            )}
                            {att.error && <p className="text-xs font-semibold text-rose-500">{att.error}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className="text-xs font-semibold text-slate-500 underline-offset-4 hover:text-[#6b0f1a] hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#f5e6c8] via-white to-[#c0c0c0]/60 px-4 py-4 text-sm text-slate-800 shadow-inner">
                  <div className="flex flex-wrap gap-2 text-xs font-semibold text-[#4b0c14]">
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#d4af37]">Wine & champagne gold theme</span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#d4af37]">Unlimited uploads</span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#d4af37]">QR shareable</span>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white"
                    style={{ background: `linear-gradient(135deg, ${colors.wine}, ${colors.deepWine})` }}
                  >
                    {submitting ? "Uploading..." : "Send love & upload"}
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </form>
            </main>
          </div>
          ) : (
            <main className="rounded-3xl border border-white/15 bg-white/90 p-6 text-slate-900 shadow-2xl shadow-black/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#6b0f1a]">Uploaded memories</p>
                  <h2 className="text-3xl font-semibold text-slate-900">Photos, videos & downloads</h2>
                </div>
                <button type="button" onClick={() => setActivePage("upload")} className="rounded-xl bg-[#6b0f1a] px-4 py-2 text-sm font-semibold text-white shadow">Back to upload</button>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {(["photos", "videos", "downloads"] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setGalleryTab(tab)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${galleryTab === tab ? "bg-[#6b0f1a] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{tab}</button>
                ))}
              </div>
              <div className="mt-6">
                {galleryTab !== "downloads" ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {attachments.filter((att) => galleryTab === "photos" ? att.file.type.startsWith("image") : att.file.type.startsWith("video")).map((att) => (
                      <article key={att.id} className="overflow-hidden rounded-2xl bg-white shadow ring-1 ring-slate-100">
                        {att.file.type.startsWith("image") ? <img src={att.preview} alt={att.file.name} className="h-56 w-full object-cover" /> : <video src={att.preview} controls className="h-56 w-full bg-black object-contain" />}
                        <div className="p-3"><p className="truncate text-sm font-semibold text-slate-800">{att.file.name}</p><p className="text-xs text-slate-500">{formatBytes(att.file.size)} · {att.status}</p></div>
                      </article>
                    ))}
                    {attachments.filter((att) => galleryTab === "photos" ? att.file.type.startsWith("image") : att.file.type.startsWith("video")).length === 0 && <p className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow">No {galleryTab} selected yet. Add files from the landing page.</p>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {attachments.map((att) => (
                      <a key={att.id} href={att.url || att.preview} download={att.file.name} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm shadow ring-1 ring-slate-100 hover:ring-[#d4af37]">
                        <span><strong className="text-slate-900">{att.file.name}</strong><br /><span className="text-xs text-slate-500">{formatBytes(att.file.size)} · {att.file.type || "file"}</span></span>
                        <span className="rounded-full bg-[#f5e6c8] px-3 py-1 font-semibold text-[#6b0f1a]">Download</span>
                      </a>
                    ))}
                    {attachments.length === 0 && <p className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow">No downloads yet. Add files from the landing page.</p>}
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
