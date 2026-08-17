import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import { formatBytes } from "@/lib/format";

type GalleryTab = "photos" | "videos" | "downloads";
type MediaKind = "photo" | "video";

type PublicMediaItem = {
  path: string;
  fileName: string;
  kind: MediaKind;
  size: number;
  lastModified?: Date;
  previewUrl?: string;
};

type PublicGalleryProps = {
  onBack: () => void;
};

const IMAGE_EXTENSIONS = new Set([
  "arw",
  "avif",
  "bmp",
  "cr2",
  "dng",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "nef",
  "orf",
  "png",
  "rw2",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const VIDEO_EXTENSIONS = new Set([
  "3gp",
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogv",
  "webm",
  "wmv",
]);

function mediaKind(path: string, contentType?: string): MediaKind | null {
  const normalizedType = contentType?.toLowerCase() || "";
  if (normalizedType.startsWith("image/")) return "photo";
  if (normalizedType.startsWith("video/")) return "video";

  const extension = path.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.has(extension)) return "photo";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function fileNameFromPath(path: string) {
  const storedName = path.split("/").pop() || "wedding-memory";
  // Guest uploads are prefixed with Date.now(). Remove that implementation
  // detail so downloads retain a friendly filename.
  return storedName.replace(/^\d{10,17}-/, "") || storedName;
}

function safeDownloadName(fileName: string) {
  return fileName.replace(/["\\\r\n]/g, "_");
}

function formatMediaDate(value?: Date) {
  if (!value) return "Wedding memory";
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/network|fetch/i.test(message)) {
    return "We could not reach the wedding gallery. Check your connection and try again.";
  }
  if (/access|authorized|credential|permission|forbidden/i.test(message)) {
    return "The public gallery is not available right now. Please try again shortly.";
  }
  return "We could not load the wedding memories. Please refresh and try again.";
}

export function PublicGallery({ onBack }: PublicGalleryProps) {
  const [activeTab, setActiveTab] = useState<GalleryTab>("photos");
  const [media, setMedia] = useState<PublicMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<string[]>([]);
  const requestId = useRef(0);

  const loadMedia = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadError("");
    setActionError("");
    setFailedPreviews([]);

    try {
      // The guest storage role can list/read media/*. Excluding subpaths keeps
      // generated thumbnail/processed folders from appearing as duplicates.
      const result = await list({
        path: "media/",
        options: {
          listAll: true,
          subpathStrategy: { strategy: "exclude" },
        },
      });

      const listedMedia = result.items
        .reduce<PublicMediaItem[]>((items, item) => {
          const kind = mediaKind(item.path, item.contentType);
          if (kind) {
            items.push({
              path: item.path,
              fileName: fileNameFromPath(item.path),
              kind,
              size: item.size || 0,
              lastModified: item.lastModified,
            });
          }
          return items;
        }, [])
        .sort(
          (a, b) =>
            (b.lastModified?.getTime() || 0) -
            (a.lastModified?.getTime() || 0)
        );

      // Preview URLs are temporary and read-only. Sign them in small batches
      // so a large wedding gallery does not overwhelm the guest's browser or
      // credential provider. A failed URL should not hide any other memory.
      const withPreviewUrls: PublicMediaItem[] = [];
      const previewBatchSize = 8;
      for (let index = 0; index < listedMedia.length; index += previewBatchSize) {
        if (requestId.current !== currentRequest) return;
        const batch = listedMedia.slice(index, index + previewBatchSize);
        const signedBatch = await Promise.all(
          batch.map(async (item) => {
            try {
              const { url } = await getUrl({
                path: item.path,
                options: { expiresIn: 3600 },
              });
              return { ...item, previewUrl: url.toString() };
            } catch {
              return item;
            }
          })
        );
        withPreviewUrls.push(...signedBatch);
      }

      if (requestId.current === currentRequest) {
        setMedia(withPreviewUrls);
      }
    } catch (error) {
      if (requestId.current === currentRequest) {
        setMedia([]);
        setLoadError(errorMessage(error));
      }
    } finally {
      if (requestId.current === currentRequest) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadMedia();
    return () => {
      requestId.current += 1;
    };
  }, [loadMedia]);

  const photos = useMemo(
    () => media.filter((item) => item.kind === "photo"),
    [media]
  );
  const videos = useMemo(
    () => media.filter((item) => item.kind === "video"),
    [media]
  );
  const visibleMedia = activeTab === "photos" ? photos : videos;

  const markPreviewFailed = (path: string) => {
    setFailedPreviews((current) =>
      current.includes(path) ? current : [...current, path]
    );
  };

  const downloadMedia = async (item: PublicMediaItem) => {
    setDownloadingPath(item.path);
    setActionError("");
    try {
      const downloadName = safeDownloadName(item.fileName);
      const { url } = await getUrl({
        path: item.path,
        options: {
          expiresIn: 300,
          contentDisposition: {
            type: "attachment",
            filename: downloadName,
          },
        },
      });

      const anchor = document.createElement("a");
      anchor.href = url.toString();
      anchor.download = downloadName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error("Public media download failed:", error);
      setActionError(
        `Could not download ${item.fileName}. Please try again in a moment.`
      );
    } finally {
      setDownloadingPath(null);
    }
  };

  const renderPreview = (item: PublicMediaItem) => {
    const previewUnavailable =
      !item.previewUrl || failedPreviews.includes(item.path);

    if (previewUnavailable) {
      return (
        <div className="flex h-56 flex-col items-center justify-center bg-gradient-to-br from-[#f5e6c8] to-slate-100 px-5 text-center text-[#6b0f1a]">
          <span className="text-4xl" aria-hidden>
            {item.kind === "photo" ? "🖼️" : "🎞️"}
          </span>
          <p className="mt-3 text-sm font-semibold">Preview unavailable</p>
          <p className="mt-1 text-xs text-slate-600">
            You can still download the original file.
          </p>
        </div>
      );
    }

    if (item.kind === "photo") {
      return (
        <a
          href={item.previewUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${item.fileName}`}
          className="block bg-slate-100"
        >
          <img
            src={item.previewUrl}
            alt={item.fileName}
            loading="lazy"
            decoding="async"
            onError={() => markPreviewFailed(item.path)}
            className="h-56 w-full object-cover transition duration-300 hover:scale-[1.02]"
          />
        </a>
      );
    }

    return (
      <video
        src={item.previewUrl}
        controls
        playsInline
        preload="metadata"
        onError={() => markPreviewFailed(item.path)}
        className="h-56 w-full bg-black object-contain"
      >
        Your browser does not support video playback.
      </video>
    );
  };

  return (
    <main className="rounded-3xl border border-white/15 bg-white/95 p-5 text-slate-900 shadow-2xl shadow-black/40 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d4af37]/25 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b0f1a]">
            ✨ Public wedding gallery
          </p>
          <h2 className="mt-1 text-3xl font-semibold text-slate-900">
            Relive every shared memory
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Anyone with this page link can view and download the photos and
            videos shared for Olanrewaju & Dolapo. Only the couple can delete
            files.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadMedia()}
            disabled={loading}
            className="rounded-xl border border-[#6b0f1a]/20 bg-white px-4 py-2 text-sm font-semibold text-[#6b0f1a] shadow-sm transition hover:bg-[#f5e6c8]/60 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "↻ Refresh gallery"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl bg-[#6b0f1a] px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-[#4b0c14]"
          >
            ← Share memories
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Photos", value: photos.length, icon: "📷" },
          { label: "Videos", value: videos.length, icon: "🎥" },
          { label: "Total memories", value: media.length, icon: "💞" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-[#d4af37]/25 bg-gradient-to-br from-[#fffdf8] to-[#f5e6c8]/55 px-4 py-3"
          >
            <p className="text-xs text-[#6b0f1a]/70">
              {stat.icon} {stat.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-[#4b0c14]">
              {loading ? "—" : stat.value}
            </p>
          </div>
        ))}
      </div>

      <div
        className="mt-6 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Gallery sections"
      >
        {(["photos", "videos", "downloads"] as const).map((tab) => {
          const count =
            tab === "photos"
              ? photos.length
              : tab === "videos"
                ? videos.length
                : media.length;
          const icon = tab === "photos" ? "📷" : tab === "videos" ? "🎥" : "⬇️";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                activeTab === tab
                  ? "bg-[#6b0f1a] text-white shadow"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {icon} {tab} ({loading ? "…" : count})
            </button>
          );
        })}
      </div>

      {actionError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
        >
          {actionError}
        </div>
      )}

      <div className="mt-6" role="tabpanel">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div
                key={item}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
              >
                <div className="h-56 animate-pulse bg-slate-200" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading public wedding gallery…</span>
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
            <p className="text-3xl" aria-hidden>📡</p>
            <p className="mt-3 font-semibold text-rose-800">Gallery unavailable</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-rose-700">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => void loadMedia()}
              className="mt-4 rounded-xl bg-[#6b0f1a] px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : activeTab === "downloads" ? (
          media.length > 0 ? (
            <div className="space-y-3">
              {media.map((item) => (
                <div
                  key={item.path}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f5e6c8] text-xl"
                      aria-hidden
                    >
                      {item.kind === "photo" ? "📷" : "🎥"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.fileName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatBytes(item.size)} · {formatMediaDate(item.lastModified)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void downloadMedia(item)}
                    disabled={downloadingPath === item.path}
                    className="shrink-0 rounded-xl bg-[#f5e6c8] px-4 py-2 text-sm font-semibold text-[#6b0f1a] transition hover:bg-[#d4af37]/35 disabled:cursor-wait disabled:opacity-60"
                  >
                    {downloadingPath === item.path
                      ? "Preparing…"
                      : "⬇️ Download original"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-600">
              <p className="text-3xl" aria-hidden>💌</p>
              <p className="mt-2 font-semibold text-slate-800">
                No memories have been uploaded yet
              </p>
              <p className="mt-1">Be the first to share a wedding photo or video.</p>
            </div>
          )
        ) : visibleMedia.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleMedia.map((item) => (
              <article
                key={item.path}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                {renderPreview(item)}
                <div className="p-4">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {item.fileName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatBytes(item.size)} · {formatMediaDate(item.lastModified)}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {item.previewUrl && !failedPreviews.includes(item.path) && (
                      <a
                        href={item.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        View ↗
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void downloadMedia(item)}
                      disabled={downloadingPath === item.path}
                      className="ml-auto rounded-lg bg-[#f5e6c8] px-3 py-2 text-xs font-semibold text-[#6b0f1a] transition hover:bg-[#d4af37]/35 disabled:cursor-wait disabled:opacity-60"
                    >
                      {downloadingPath === item.path ? "Preparing…" : "⬇️ Download"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-600">
            <p className="text-3xl" aria-hidden>
              {activeTab === "photos" ? "📷" : "🎥"}
            </p>
            <p className="mt-2 font-semibold text-slate-800">
              No {activeTab} have been uploaded yet
            </p>
            <p className="mt-1">Be the first to share one from the upload page.</p>
          </div>
        )}
      </div>
    </main>
  );
}
