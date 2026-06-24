import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

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
  const [shareUrl, setShareUrl] = useState("https://your-wedding-form.com");
  const [form, setForm] = useState<FormState>(initialForm);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadMode, setUploadMode] = useState<UploadMode>("demo");
  const [uploadEndpoint, setUploadEndpoint] = useState("");
  const [cdnBase, setCdnBase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready for your love notes and memories.");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setShareUrl(window.location.href);
    }
  }, []);

  const stats = useMemo(() => {
    const totalBytes = attachments.reduce((sum, a) => sum + a.file.size, 0);
    const imageCount = attachments.filter((a) => a.file.type.startsWith("image")).length;
    const videoCount = attachments.filter((a) => a.file.type.startsWith("video")).length;
    const done = attachments.filter((a) => a.status === "done").length;
    return { totalBytes, imageCount, videoCount, done };
  }, [attachments]);

  const uploadStrategy: UploadMode =
    uploadMode === "presigned" && uploadEndpoint ? "presigned" : "demo";

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
      const presign = await fetch(uploadEndpoint, {
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
      await uploadAttachment(att, uploadStrategy);
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
        backgroundImage: "linear-gradient(135deg, rgba(75,12,20,0.85), rgba(26,23,23,0.75)), url('/images/wedding-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
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

          <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">
            <aside className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 shadow-xl shadow-black/30">
                <div className="flex items-center justify-between text-white/80">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">Share it</p>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-900 shadow">QR ready</span>
                </div>
                <div className="mt-3 flex items-center gap-4">
                  <div className="rounded-2xl border border-white/25 bg-white/80 p-3 shadow-lg">
                    <QRCodeCanvas value={shareUrl} size={112} bgColor="#ffffff" fgColor={colors.deepWine} />
                  </div>
                  <div className="flex-1 space-y-3 text-white/90">
                    <div>
                      <p className="text-sm font-semibold text-white">Scan to open this exact form</p>
                      <p className="text-xs text-white/75">Guests scan the QR at your venue and land right here.</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        value={shareUrl}
                        onChange={(e) => setShareUrl(e.target.value)}
                        className="w-full rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[#d4af37] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                        placeholder="https://your-amplify-domain.com"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(shareUrl);
                            setStatusMessage("Link copied. Ready to share.");
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-[1px]"
                          style={{ background: colors.wine }}
                        >
                          <span>Copy link</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShareUrl(window.location.href)}
                          className="rounded-xl border border-white/30 bg-white/20 px-3 py-2 text-sm font-semibold text-white hover:border-[#d4af37]/60"
                        >
                          Use current page
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 shadow-xl shadow-black/30 text-white/90">
                <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">Upload strategy</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-medium">
                  <button
                    type="button"
                    onClick={() => setUploadMode("demo")}
                    className={`rounded-2xl border px-3 py-3 text-left shadow-sm transition ${uploadMode === "demo" ? "border-[#d4af37] bg-white/80 text-slate-900" : "border-white/30 bg-white/10 text-white"}`}
                  >
                    <p>Demo / offline safe</p>
                    <p className="text-xs opacity-80">Simulated uploads with preview</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode("presigned")}
                    className={`rounded-2xl border px-3 py-3 text-left shadow-sm transition ${uploadMode === "presigned" ? "border-[#d4af37] bg-white/80 text-slate-900" : "border-white/30 bg-white/10 text-white"}`}
                  >
                    <p>Use pre-signed URL</p>
                    <p className="text-xs opacity-80">Connect to S3 / R2 / Wasabi</p>
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-[#f5e6c8]">Presign endpoint</span>
                    <input
                      value={uploadEndpoint}
                      onChange={(e) => setUploadEndpoint(e.target.value)}
                      placeholder="https://api.yourdomain.com/presign"
                      className="rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[#d4af37] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-[#f5e6c8]">Public CDN/base URL (optional)</span>
                    <input
                      value={cdnBase}
                      onChange={(e) => setCdnBase(e.target.value)}
                      placeholder="https://cdn.yourdomain.com/wedding"
                      className="rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[#d4af37] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30"
                    />
                  </label>
                  <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/80">
                    <p className="font-semibold text-[#f5e6c8]">Expected API (pre-sign)</p>
                    <p>POST {'{'} filename, contentType, size {'}'} → {'{'} uploadUrl, fileUrl?, fields? {'}'}</p>
                    <p className="mt-1 text-white/70">If fields are returned, a POST with form-data is used. Otherwise a PUT is used.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 shadow-xl shadow-black/30 text-white/90">
                <p className="text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">Amplify hosting quick start</p>
                <ol className="mt-3 space-y-2 text-sm text-white/80 list-decimal list-inside">
                  <li>Push this repo to GitHub.</li>
                  <li>Open AWS Amplify → New app → Host web app → connect your repo.</li>
                  <li>Build command: <code className="rounded bg-white/20 px-1">npm ci && npm run build</code></li>
                  <li>Output dir: <code className="rounded bg-white/20 px-1">dist</code></li>
                  <li>After deploy, use the Amplify domain in the QR field above.</li>
                </ol>
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
        </div>
      </div>
    </div>
  );
}
