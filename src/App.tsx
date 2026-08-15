import {
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import imageCompression from "browser-image-compression";
import { uploadData } from "aws-amplify/storage";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import {
  COLORS as colors,
  DEFAULT_ADMIN_PASSWORD,
  MAX_VIDEO_BYTES,
} from "@/config/constants";
import {
  adminChangePassword,
  adminConfirmPasswordReset,
  adminRequestPasswordReset,
  adminSignIn,
  completeNewPassword,
  getAdminSession,
  safeSignOut,
} from "@/lib/adminAuth";
import {
  csvEscape,
  downloadBlob,
  formatBytes,
  formatEntryDate,
  randomId,
} from "@/lib/format";

// Guest uploads use default IAM auth mode from amplify_outputs.
// Admin list/read uses userPool after Cognito sign-in.
const dataClient = generateClient<Schema>();
const adminDataClient = generateClient<Schema>({
  authMode: "userPool",
});

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

const DEFAULT_CDN_BASE_URL = "";

type AdminAuthView =
  | "login"
  | "changePassword"
  | "newPasswordRequired"
  | "forgot"
  | "reset";

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
  const uploadMode: UploadMode = "amplify";
  const uploadEndpoint = "";
  const cdnBase = DEFAULT_CDN_BASE_URL;
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Ready for your love notes and memories."
  );

  // ✅ NEW: Failed upload warning state
  const [failedFiles, setFailedFiles] = useState<string[]>([]);

  // ✅ Admin Dashboard state (Cognito-backed)
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminSessionEmail, setAdminSessionEmail] = useState("");
  const [adminAuthView, setAdminAuthView] = useState<AdminAuthView>("login");
  const [adminAuthError, setAdminAuthError] = useState("");
  const [adminAuthInfo, setAdminAuthInfo] = useState("");
  const [adminAuthBusy, setAdminAuthBusy] = useState(false);
  const [adminSessionChecking, setAdminSessionChecking] = useState(true);
  const [changeCurrentPassword, setChangeCurrentPassword] = useState("");
  const [changeNewPassword, setChangeNewPassword] = useState("");
  const [changeConfirmPassword, setChangeConfirmPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [guestEntries, setGuestEntries] = useState<any[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [adminTab, setAdminTab] = useState<
    "overview" | "guests" | "loveboard" | "media" | "tools"
  >("overview");
  const [adminSearch, setAdminSearch] = useState("");
  const [adminAttendanceFilter, setAdminAttendanceFilter] = useState("all");
  const [adminRatingFilter, setAdminRatingFilter] = useState("all");
  const [adminSort, setAdminSort] = useState<"newest" | "oldest" | "rating" | "name">(
    "newest"
  );
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("wedding-admin-starred");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("wedding-admin-notes");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  // ✅ Load guest entries — requires authenticated Cognito session
  const loadGuestEntries = async () => {
    setLoadingEntries(true);
    try {
      const { data: entries } = await adminDataClient.models.GuestEntry.list({
        limit: 1000,
      });
      setGuestEntries(entries || []);
    } catch (error) {
      console.error("Failed to load entries:", error);
      alert(
        "Failed to load guest entries. Your session may have expired — try signing in again."
      );
    } finally {
      setLoadingEntries(false);
    }
  };

  const clearAdminAuthMessages = () => {
    setAdminAuthError("");
    setAdminAuthInfo("");
  };

  const completeAdminLogin = (email: string) => {
    setAdminAuthed(true);
    setAdminSessionEmail(email);
    setAdminAuthView("login");
    setAdminPasswordInput("");
    setChangeCurrentPassword("");
    setChangeNewPassword("");
    setChangeConfirmPassword("");
    clearAdminAuthMessages();
    loadGuestEntries();
  };

  const handleAdminLogout = async () => {
    setAdminAuthBusy(true);
    try {
      await safeSignOut();
    } finally {
      setAdminAuthed(false);
      setAdminSessionEmail("");
      setGuestEntries([]);
      setExpandedEntryId(null);
      setAdminAuthView("login");
      setAdminPasswordInput("");
      setAdminEmail("");
      clearAdminAuthMessages();
      setAdminAuthBusy(false);
    }
  };

  // Restore Cognito session when opening admin
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (activePage !== "admin") {
        setAdminSessionChecking(false);
        return;
      }
      setAdminSessionChecking(true);
      try {
        const session = await getAdminSession();
        if (cancelled) return;
        if (session) {
          setAdminSessionEmail(session.email);
          setAdminEmail(session.email);
          if (session.mustChangePassword) {
            setAdminAuthed(false);
            setAdminAuthView("changePassword");
            setAdminAuthInfo(
              "For your security, please set a new password before entering the dashboard."
            );
          } else {
            setAdminAuthed(true);
            setAdminAuthView("login");
            loadGuestEntries();
          }
        }
      } finally {
        if (!cancelled) setAdminSessionChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  // Cognito email + password sign-in (allowlisted couple emails only)
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminAuthMessages();
    setAdminAuthBusy(true);
    try {
      const result = await adminSignIn(adminEmail, adminPasswordInput);
      if (result.status === "error") {
        setAdminAuthError(result.message);
        setAdminPasswordInput("");
        return;
      }
      if (result.status === "confirmSignIn") {
        setAdminSessionEmail(adminEmail.trim().toLowerCase());
        setAdminAuthView("newPasswordRequired");
        setAdminAuthInfo(
          "Your account requires a new password before you can continue."
        );
        setAdminPasswordInput("");
        return;
      }
      setAdminSessionEmail(result.email);
      setAdminEmail(result.email);
      if (result.mustChangePassword) {
        setAdminAuthView("changePassword");
        setAdminAuthInfo(
          "For your security, please set a new password before entering the dashboard."
        );
        setAdminPasswordInput("");
        return;
      }
      completeAdminLogin(result.email);
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const handleForcedPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminAuthMessages();

    if (changeNewPassword.length < 8) {
      setAdminAuthError("New password must be at least 8 characters.");
      return;
    }
    if (changeNewPassword === DEFAULT_ADMIN_PASSWORD) {
      setAdminAuthError(
        "Please choose something other than the default password."
      );
      return;
    }
    if (changeNewPassword !== changeConfirmPassword) {
      setAdminAuthError("New passwords do not match.");
      return;
    }
    if (changeNewPassword === changeCurrentPassword) {
      setAdminAuthError(
        "New password must be different from the current one."
      );
      return;
    }

    setAdminAuthBusy(true);
    try {
      const result = await adminChangePassword(
        changeCurrentPassword,
        changeNewPassword
      );
      if (!result.ok) {
        setAdminAuthError(result.message);
        return;
      }
      const email =
        adminSessionEmail || adminEmail.trim().toLowerCase();
      completeAdminLogin(email);
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const handleNewPasswordRequired = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminAuthMessages();
    if (changeNewPassword.length < 8) {
      setAdminAuthError("New password must be at least 8 characters.");
      return;
    }
    if (changeNewPassword === DEFAULT_ADMIN_PASSWORD) {
      setAdminAuthError(
        "Please choose something other than the default password."
      );
      return;
    }
    if (changeNewPassword !== changeConfirmPassword) {
      setAdminAuthError("New passwords do not match.");
      return;
    }
    setAdminAuthBusy(true);
    try {
      const result = await completeNewPassword(changeNewPassword);
      if (result.status === "error") {
        setAdminAuthError(result.message);
        return;
      }
      if (result.status !== "authenticated") {
        setAdminAuthError("Could not complete sign-in. Try again.");
        return;
      }
      completeAdminLogin(result.email);
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminAuthMessages();
    setAdminAuthBusy(true);
    try {
      const result = await adminRequestPasswordReset(
        forgotEmail || adminEmail
      );
      if (!result.ok) {
        setAdminAuthError(result.message);
        return;
      }
      setAdminEmail((forgotEmail || adminEmail).trim().toLowerCase());
      setForgotEmail((forgotEmail || adminEmail).trim().toLowerCase());
      setAdminAuthView("reset");
      setAdminAuthInfo(result.message);
      setResetCode("");
      setResetNewPassword("");
      setResetConfirmPassword("");
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminAuthMessages();
    if (resetNewPassword !== resetConfirmPassword) {
      setAdminAuthError("New passwords do not match.");
      return;
    }
    setAdminAuthBusy(true);
    try {
      const result = await adminConfirmPasswordReset({
        email: forgotEmail || adminEmail,
        code: resetCode,
        newPassword: resetNewPassword,
      });
      if (!result.ok) {
        setAdminAuthError(result.message);
        return;
      }
      setAdminEmail((forgotEmail || adminEmail).trim().toLowerCase());
      setAdminPasswordInput("");
      setResetCode("");
      setResetNewPassword("");
      setResetConfirmPassword("");
      setAdminAuthView("login");
      setAdminAuthInfo(result.message);
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const handleOptionalPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminAuthMessages();
    if (changeNewPassword !== changeConfirmPassword) {
      setAdminAuthError("New passwords do not match.");
      return;
    }
    setAdminAuthBusy(true);
    try {
      const result = await adminChangePassword(
        changeCurrentPassword,
        changeNewPassword
      );
      if (!result.ok) {
        setAdminAuthError(result.message);
        return;
      }
      setChangeCurrentPassword("");
      setChangeNewPassword("");
      setChangeConfirmPassword("");
      setAdminAuthInfo("Password changed successfully.");
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const persistStarred = (ids: string[]) => {
    setStarredIds(ids);
    try {
      localStorage.setItem("wedding-admin-starred", JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  };

  const toggleStarred = (id: string) => {
    const next = starredIds.includes(id)
      ? starredIds.filter((x) => x !== id)
      : [...starredIds, id];
    persistStarred(next);
  };

  const saveAdminNote = (id: string, note: string) => {
    const next = { ...adminNotes, [id]: note };
    setAdminNotes(next);
    try {
      localStorage.setItem("wedding-admin-notes", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const exportEntriesCsv = (entries: any[]) => {
    const headers = [
      "names",
      "email",
      "relation",
      "attendance",
      "rating",
      "highlight",
      "story",
      "suggestions",
      "mediaCount",
      "mediaKeys",
      "starred",
      "adminNote",
      "createdAt",
      "id",
    ];
    const rows = entries.map((e) =>
      [
        e.names,
        e.email,
        e.relation,
        e.attendance,
        e.rating,
        e.highlight,
        e.story,
        e.suggestions,
        e.mediaKeys?.length || 0,
        (e.mediaKeys || []).join(" | "),
        starredIds.includes(e.id) ? "yes" : "no",
        adminNotes[e.id] || "",
        e.createdAt,
        e.id,
      ]
        .map(csvEscape)
        .join(",")
    );
    downloadBlob(
      `olanrewaju-dolapo-guests-${new Date().toISOString().slice(0, 10)}.csv`,
      [headers.join(","), ...rows].join("\n"),
      "text/csv;charset=utf-8"
    );
  };

  const exportEntriesJson = (entries: any[]) => {
    const payload = entries.map((e) => ({
      ...e,
      starred: starredIds.includes(e.id),
      adminNote: adminNotes[e.id] || "",
    }));
    downloadBlob(
      `olanrewaju-dolapo-guests-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  const copyEntryText = async (entry: any) => {
    const text = [
      `From: ${entry.names}`,
      entry.email ? `Email: ${entry.email}` : null,
      `Relation: ${entry.relation}`,
      `Attendance: ${entry.attendance}`,
      `Rating: ${entry.rating}/10`,
      entry.highlight ? `Favorite moment: ${entry.highlight}` : null,
      entry.story ? `Story:\n${entry.story}` : null,
      entry.suggestions ? `Wishes:\n${entry.suggestions}` : null,
      entry.mediaKeys?.length
        ? `Files (${entry.mediaKeys.length}):\n${entry.mediaKeys
            .map((k: string) => `• ${k}`)
            .join("\n")}`
        : null,
      `Submitted: ${formatEntryDate(entry.createdAt)}`,
      `#morenikeji #dolan26 #TheFashinas`,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      alert("Could not copy — your browser blocked clipboard access.");
    }
  };

  const adminStats = useMemo(() => {
    const total = guestEntries.length;
    const withMedia = guestEntries.filter(
      (e) => e.mediaKeys && e.mediaKeys.length > 0
    ).length;
    const mediaCount = guestEntries.reduce(
      (sum, e) => sum + (e.mediaKeys?.length || 0),
      0
    );
    const avgRating =
      total === 0
        ? 0
        : guestEntries.reduce((sum, e) => sum + (Number(e.rating) || 0), 0) /
          total;
    const attendanceMap: Record<string, number> = {};
    const relationMap: Record<string, number> = {};
    guestEntries.forEach((e) => {
      const a = e.attendance || "Unknown";
      const r = e.relation || "Unknown";
      attendanceMap[a] = (attendanceMap[a] || 0) + 1;
      relationMap[r] = (relationMap[r] || 0) + 1;
    });
    const topRated = [...guestEntries]
      .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
      .slice(0, 5);
    const latest = [...guestEntries]
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
      )
      .slice(0, 5);
    const loveNotes = guestEntries
      .filter((e) => e.story || e.highlight || e.suggestions)
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
      );
    const mediaRows = guestEntries.flatMap((e) =>
      (e.mediaKeys || []).map((key: string) => ({
        key,
        guest: e.names,
        email: e.email,
        entryId: e.id,
        createdAt: e.createdAt,
      }))
    );
    const attendanceOptions = Object.keys(attendanceMap).sort();
    return {
      total,
      withMedia,
      mediaCount,
      avgRating,
      attendanceMap,
      relationMap,
      topRated,
      latest,
      loveNotes,
      mediaRows,
      attendanceOptions,
      starredCount: starredIds.filter((id) =>
        guestEntries.some((e) => e.id === id)
      ).length,
    };
  }, [guestEntries, starredIds]);

  const filteredEntries = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    let list = [...guestEntries];

    if (q) {
      list = list.filter((e) => {
        const hay = [
          e.names,
          e.email,
          e.relation,
          e.attendance,
          e.highlight,
          e.story,
          e.suggestions,
          ...(e.mediaKeys || []),
          adminNotes[e.id] || "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (adminAttendanceFilter !== "all") {
      list = list.filter((e) => e.attendance === adminAttendanceFilter);
    }

    if (adminRatingFilter === "9plus") {
      list = list.filter((e) => Number(e.rating) >= 9);
    } else if (adminRatingFilter === "starred") {
      list = list.filter((e) => starredIds.includes(e.id));
    } else if (adminRatingFilter === "withMedia") {
      list = list.filter((e) => e.mediaKeys && e.mediaKeys.length > 0);
    } else if (adminRatingFilter === "withNotes") {
      list = list.filter((e) => (adminNotes[e.id] || "").trim().length > 0);
    }

    list.sort((a, b) => {
      if (adminSort === "rating") {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      if (adminSort === "name") {
        return String(a.names || "").localeCompare(String(b.names || ""));
      }
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return adminSort === "oldest" ? ta - tb : tb - ta;
    });

    return list;
  }, [
    guestEntries,
    adminSearch,
    adminAttendanceFilter,
    adminRatingFilter,
    adminSort,
    starredIds,
    adminNotes,
  ]);

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
    const renderEntryCard = (entry: any, idx: number) => {
      const isExpanded = expandedEntryId === entry.id;
      const isStarred = starredIds.includes(entry.id);
      const note = adminNotes[entry.id] || "";

      return (
        <div
          key={entry.id || idx}
          className={`rounded-2xl border p-5 backdrop-blur-sm transition ${
            isStarred
              ? "border-[#d4af37]/50 bg-gradient-to-br from-[#d4af37]/15 to-white/5"
              : "border-white/10 bg-white/10"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold text-white">{entry.names}</h3>
                {isStarred && (
                  <span className="rounded-full bg-[#d4af37]/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
                    Favorite
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {entry.relation && (
                  <span className="rounded-full bg-[#d4af37]/20 px-3 py-1 font-semibold text-[#d4af37]">
                    {entry.relation}
                  </span>
                )}
                {entry.attendance && (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-white">
                    {entry.attendance}
                  </span>
                )}
                <span className="rounded-full bg-yellow-500/20 px-3 py-1 font-semibold text-yellow-300">
                  ⭐ {entry.rating}/10
                </span>
                {entry.mediaKeys?.length > 0 && (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-[#f5e6c8]">
                    📁 {entry.mediaKeys.length} file
                    {entry.mediaKeys.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleStarred(entry.id)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  isStarred
                    ? "bg-[#d4af37]/25 text-[#d4af37]"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
                title="Star as favorite"
              >
                {isStarred ? "★ Starred" : "☆ Star"}
              </button>
              <button
                type="button"
                onClick={() => copyEntryText(entry)}
                className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                {copiedId === entry.id ? "✓ Copied" : "📋 Copy"}
              </button>
              {entry.email && (
                <a
                  href={`mailto:${entry.email}?subject=${encodeURIComponent(
                    "Thank you from Olanrewaju & Dolapo"
                  )}&body=${encodeURIComponent(
                    `Dear ${entry.names},\n\nThank you so much for your beautiful words and for celebrating with us.\n\nWith love,\nOlanrewaju & Dolapo\n#morenikeji #dolan26 #TheFashinas`
                  )}`}
                  className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-[#d4af37] transition hover:bg-white/20"
                >
                  📧 Reply
                </a>
              )}
              <button
                type="button"
                onClick={() =>
                  setExpandedEntryId(isExpanded ? null : entry.id)
                }
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
              >
                {isExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
          </div>

          {/* Preview strip */}
          <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-2">
            {entry.highlight && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#f5e6c8]/80">
                  Favorite moment
                </p>
                <p className="mt-1 text-sm text-white/90 line-clamp-2">
                  {entry.highlight}
                </p>
              </div>
            )}
            {entry.story && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#f5e6c8]/80">
                  Their story
                </p>
                <p className="mt-1 text-sm text-white/90 line-clamp-2">
                  {entry.story}
                </p>
              </div>
            )}
          </div>

          {isExpanded && (
            <div className="mt-4 space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
              {entry.highlight && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#f5e6c8]">
                    Favorite moment
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-white/90">
                    {entry.highlight}
                  </p>
                </div>
              )}
              {entry.story && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#f5e6c8]">
                    Their story
                  </p>
                  <p className="mt-1 max-h-48 overflow-y-auto text-sm leading-relaxed text-white/90 whitespace-pre-wrap">
                    {entry.story}
                  </p>
                </div>
              )}
              {entry.suggestions && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#f5e6c8]">
                    Wishes & suggestions
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-white/90 whitespace-pre-wrap">
                    {entry.suggestions}
                  </p>
                </div>
              )}
              {entry.mediaKeys && entry.mediaKeys.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#f5e6c8]">
                    📁 Files ({entry.mediaKeys.length})
                  </p>
                  <ul className="mt-2 space-y-1">
                    {entry.mediaKeys.map((key: string, i: number) => (
                      <li
                        key={i}
                        className="truncate rounded-lg bg-white/5 px-3 py-2 font-mono text-xs text-white/70"
                      >
                        {key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[#f5e6c8]">
                  Private admin note
                </label>
                <textarea
                  value={note}
                  onChange={(e) => saveAdminNote(entry.id, e.target.value)}
                  rows={2}
                  placeholder="e.g. Print this for the scrapbook, send thank-you card..."
                  className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-white/50">
            <span className="truncate font-mono">ID: {entry.id}</span>
            <span>{formatEntryDate(entry.createdAt)}</span>
          </div>
        </div>
      );
    };

    return (
      <div
        className="min-h-screen bg-slate-900 text-white"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(75,12,20,0.92), rgba(26,23,23,0.88))",
          backgroundSize: "cover",
        }}
      >
        <div className="px-4 py-8 md:py-10">
          <div className="mx-auto max-w-7xl space-y-6">
            {adminSessionChecking ? (
              <div className="mx-auto max-w-md rounded-3xl border border-[#d4af37]/30 bg-white/10 p-10 text-center">
                <svg
                  className="mx-auto h-10 w-10 animate-spin text-[#d4af37]"
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
                <p className="mt-4 text-sm text-white/70">
                  Checking secure session…
                </p>
              </div>
            ) : !adminAuthed ? (
              <div className="mx-auto max-w-md">
                <div className="relative overflow-hidden rounded-3xl border border-[#d4af37]/30 bg-gradient-to-br from-[#6b0f1a]/80 via-[#4b0c14]/90 to-[#1a1111] p-8 shadow-2xl">
                  <div
                    className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full opacity-30 blur-3xl"
                    style={{ background: colors.gold }}
                  />
                  <div className="relative text-center mb-6">
                    <div
                      className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg ring-2 ring-[#d4af37]/40"
                      style={{
                        background: `linear-gradient(135deg, ${colors.wine}, ${colors.gold})`,
                      }}
                    >
                      <span className="text-2xl">🔐</span>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">
                      Couple&apos;s Vault
                    </h1>
                    <p className="text-white/70 text-sm">
                      {adminAuthView === "login" &&
                        "Sign in with your authorized couple email"}
                      {adminAuthView === "changePassword" &&
                        "Set a new secure password to continue"}
                      {adminAuthView === "newPasswordRequired" &&
                        "Complete your account with a new password"}
                      {adminAuthView === "forgot" &&
                        "Recover access with your admin email"}
                      {adminAuthView === "reset" &&
                        "Enter the code from your email & a new password"}
                    </p>
                  </div>

                  {adminAuthError && (
                    <div className="relative mb-4 rounded-xl border border-rose-400/40 bg-rose-900/30 px-4 py-3 text-sm text-rose-200">
                      {adminAuthError}
                    </div>
                  )}
                  {adminAuthInfo && (
                    <div className="relative mb-4 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 py-3 text-sm text-[#f5e6c8] whitespace-pre-wrap">
                      {adminAuthInfo}
                    </div>
                  )}

                  {/* ── LOGIN ── */}
                  {adminAuthView === "login" && (
                    <form
                      onSubmit={handleAdminLogin}
                      className="relative space-y-4"
                    >
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Admin email
                        </span>
                        <input
                          type="email"
                          autoComplete="username"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="your@email.com"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Password
                        </span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={adminPasswordInput}
                          onChange={(e) =>
                            setAdminPasswordInput(e.target.value)
                          }
                          placeholder="Enter your password"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={adminAuthBusy}
                        className="w-full rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-3 font-semibold text-[#4b0c14] shadow-lg transition hover:-translate-y-[1px] disabled:opacity-60"
                      >
                        {adminAuthBusy ? "Signing in…" : "Sign in"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearAdminAuthMessages();
                          setForgotEmail(adminEmail);
                          setAdminAuthView("forgot");
                        }}
                        className="w-full text-center text-sm font-semibold text-[#f5e6c8]/80 underline-offset-4 hover:text-[#d4af37] hover:underline"
                      >
                        Forgot password?
                      </button>
                    </form>
                  )}

                  {/* ── FORCE / FIRST LOGIN PASSWORD CHANGE ── */}
                  {adminAuthView === "changePassword" && (
                    <form
                      onSubmit={handleForcedPasswordChange}
                      className="relative space-y-4"
                    >
                      <p className="rounded-xl border border-[#d4af37]/30 bg-black/20 px-3 py-2 text-xs text-[#f5e6c8]/90">
                        Signed in as{" "}
                        <span className="font-semibold text-[#d4af37]">
                          {adminSessionEmail || adminEmail}
                        </span>
                        . Please replace the default password before continuing.
                      </p>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Current password
                        </span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={changeCurrentPassword}
                          onChange={(e) =>
                            setChangeCurrentPassword(e.target.value)
                          }
                          placeholder="Current password"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          New password
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={changeNewPassword}
                          onChange={(e) => setChangeNewPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                          minLength={8}
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Confirm new password
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={changeConfirmPassword}
                          onChange={(e) =>
                            setChangeConfirmPassword(e.target.value)
                          }
                          placeholder="Repeat new password"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                          minLength={8}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={adminAuthBusy}
                        className="w-full rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-3 font-semibold text-[#4b0c14] shadow-lg transition hover:-translate-y-[1px] disabled:opacity-60"
                      >
                        {adminAuthBusy
                          ? "Saving…"
                          : "Save password & enter vault"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await safeSignOut();
                          setAdminSessionEmail("");
                          setAdminAuthView("login");
                          clearAdminAuthMessages();
                          setChangeCurrentPassword("");
                          setChangeNewPassword("");
                          setChangeConfirmPassword("");
                        }}
                        className="w-full text-center text-sm font-semibold text-white/70 hover:text-white"
                      >
                        ← Back to sign in
                      </button>
                    </form>
                  )}

                  {/* ── COGNITO NEW PASSWORD REQUIRED CHALLENGE ── */}
                  {adminAuthView === "newPasswordRequired" && (
                    <form
                      onSubmit={handleNewPasswordRequired}
                      className="relative space-y-4"
                    >
                      <p className="rounded-xl border border-[#d4af37]/30 bg-black/20 px-3 py-2 text-xs text-[#f5e6c8]/90">
                        Cognito requires a permanent password for{" "}
                        <span className="font-semibold text-[#d4af37]">
                          {adminSessionEmail || adminEmail}
                        </span>
                        .
                      </p>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          New password
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={changeNewPassword}
                          onChange={(e) => setChangeNewPassword(e.target.value)}
                          placeholder="At least 8 characters, include a letter & number"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                          minLength={8}
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Confirm new password
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={changeConfirmPassword}
                          onChange={(e) =>
                            setChangeConfirmPassword(e.target.value)
                          }
                          placeholder="Repeat new password"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                          minLength={8}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={adminAuthBusy}
                        className="w-full rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-3 font-semibold text-[#4b0c14] shadow-lg transition hover:-translate-y-[1px] disabled:opacity-60"
                      >
                        {adminAuthBusy ? "Saving…" : "Set password & continue"}
                      </button>
                    </form>
                  )}

                  {/* ── FORGOT PASSWORD ── */}
                  {adminAuthView === "forgot" && (
                    <form
                      onSubmit={handleForgotPassword}
                      className="relative space-y-4"
                    >
                      <p className="text-sm text-white/70">
                        Enter your authorized admin email. Cognito will email a
                        recovery code so you can set a new password.
                      </p>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Admin email
                        </span>
                        <input
                          type="email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          placeholder="your@email.com"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={adminAuthBusy}
                        className="w-full rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-3 font-semibold text-[#4b0c14] shadow-lg transition hover:-translate-y-[1px] disabled:opacity-60"
                      >
                        {adminAuthBusy ? "Sending…" : "Email recovery code"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearAdminAuthMessages();
                          setAdminAuthView("login");
                        }}
                        className="w-full text-center text-sm font-semibold text-white/70 hover:text-white"
                      >
                        ← Back to sign in
                      </button>
                    </form>
                  )}

                  {/* ── RESET WITH CODE ── */}
                  {adminAuthView === "reset" && (
                    <form
                      onSubmit={handleResetPassword}
                      className="relative space-y-4"
                    >
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Recovery code
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value)}
                          placeholder="6-digit code"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 tracking-widest focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          New password
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                          minLength={8}
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#f5e6c8]">
                          Confirm new password
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={resetConfirmPassword}
                          onChange={(e) =>
                            setResetConfirmPassword(e.target.value)
                          }
                          placeholder="Repeat new password"
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]"
                          required
                          minLength={8}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={adminAuthBusy}
                        className="w-full rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-3 font-semibold text-[#4b0c14] shadow-lg transition hover:-translate-y-[1px] disabled:opacity-60"
                      >
                        {adminAuthBusy ? "Resetting…" : "Reset password"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearAdminAuthMessages();
                          setAdminAuthView("forgot");
                        }}
                        className="w-full text-center text-sm font-semibold text-white/70 hover:text-white"
                      >
                        Request a new code
                      </button>
                    </form>
                  )}

                  <button
                    type="button"
                    onClick={() => setActivePage("upload")}
                    className="relative mt-4 w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    ← Back to portal
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <header className="relative overflow-hidden rounded-3xl border border-[#d4af37]/30 bg-gradient-to-br from-[#6b0f1a]/90 via-[#4b0c14]/85 to-[#1a1111] p-6 shadow-2xl">
                  <div
                    className="pointer-events-none absolute -top-16 right-0 h-48 w-48 rounded-full opacity-25 blur-3xl"
                    style={{ background: colors.gold }}
                  />
                  <div className="relative flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-[#d4af37]">
                        Olanrewaju & Dolapo · Private vault
                      </p>
                      <h1 className="mt-1 text-3xl md:text-4xl font-semibold text-white">
                        Love Command Center
                      </h1>
                      <p className="mt-1 text-sm text-[#f5e6c8]/80">
                        Browse messages, star favorites, export keepsakes & manage
                        memories — #morenikeji #dolan26 #TheFashinas
                      </p>
                      {adminSessionEmail && (
                        <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-1 text-xs text-[#f5e6c8]">
                          <span className="opacity-70">Signed in as</span>
                          <span className="font-semibold text-[#d4af37]">
                            {adminSessionEmail}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={loadGuestEntries}
                        className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
                      >
                        🔄 Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => exportEntriesCsv(filteredEntries)}
                        className="rounded-xl bg-[#d4af37]/20 px-4 py-2 text-sm font-semibold text-[#f5e6c8] transition hover:bg-[#d4af37]/35"
                      >
                        ⬇️ CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => exportEntriesJson(filteredEntries)}
                        className="rounded-xl bg-[#d4af37]/20 px-4 py-2 text-sm font-semibold text-[#f5e6c8] transition hover:bg-[#d4af37]/35"
                      >
                        ⬇️ JSON
                      </button>
                      <button
                        type="button"
                        onClick={handleAdminLogout}
                        className="rounded-xl bg-rose-600/20 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-600/30"
                      >
                        Logout
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePage("upload")}
                        className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        ← Portal
                      </button>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="relative mt-5 flex flex-wrap gap-2">
                    {(
                      [
                        ["overview", "📊 Overview"],
                        ["guests", "💌 Guests"],
                        ["loveboard", "✨ Love board"],
                        ["media", "📁 Media index"],
                        ["tools", "🛠️ Tools"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setAdminTab(id)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          adminTab === id
                            ? "bg-[#f5e6c8] text-[#6b0f1a] shadow-md"
                            : "bg-white/10 text-white hover:bg-white/20"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </header>

                {/* Stats strip */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    {
                      label: "Submissions",
                      value: adminStats.total,
                      hint: "total love notes",
                    },
                    {
                      label: "Avg vibes",
                      value: adminStats.avgRating
                        ? adminStats.avgRating.toFixed(1)
                        : "—",
                      hint: "out of 10",
                    },
                    {
                      label: "With media",
                      value: adminStats.withMedia,
                      hint: `${adminStats.mediaCount} files total`,
                    },
                    {
                      label: "Starred",
                      value: adminStats.starredCount,
                      hint: "your favorites",
                    },
                    {
                      label: "Showing",
                      value: filteredEntries.length,
                      hint: "after filters",
                    },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="rounded-2xl border border-[#d4af37]/25 bg-white/10 px-4 py-4 backdrop-blur-sm"
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#f5e6c8]/80">
                        {card.label}
                      </p>
                      <p className="mt-1 text-3xl font-semibold text-white">
                        {card.value}
                      </p>
                      <p className="text-xs text-white/50">{card.hint}</p>
                    </div>
                  ))}
                </div>

                {/* Search / filters (guests + tools use them) */}
                {(adminTab === "guests" ||
                  adminTab === "loveboard" ||
                  adminTab === "media") && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="md:col-span-2 flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[#f5e6c8]">
                          Search everything
                        </span>
                        <input
                          value={adminSearch}
                          onChange={(e) => setAdminSearch(e.target.value)}
                          placeholder="Name, email, story, relation, file…"
                          className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[#f5e6c8]">
                          Attendance
                        </span>
                        <select
                          value={adminAttendanceFilter}
                          onChange={(e) =>
                            setAdminAttendanceFilter(e.target.value)
                          }
                          className="rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                        >
                          <option value="all">All guests</option>
                          {adminStats.attendanceOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[#f5e6c8]">
                          Quick filter
                        </span>
                        <select
                          value={adminRatingFilter}
                          onChange={(e) => setAdminRatingFilter(e.target.value)}
                          className="rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                        >
                          <option value="all">All entries</option>
                          <option value="9plus">⭐ 9+ vibes</option>
                          <option value="starred">★ Starred only</option>
                          <option value="withMedia">With media</option>
                          <option value="withNotes">With admin notes</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-white/50">Sort:</span>
                      {(
                        [
                          ["newest", "Newest"],
                          ["oldest", "Oldest"],
                          ["rating", "Highest vibes"],
                          ["name", "Name A–Z"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setAdminSort(id)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                            adminSort === id
                              ? "bg-[#d4af37] text-[#4b0c14]"
                              : "bg-white/10 text-white/80 hover:bg-white/20"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      {(adminSearch ||
                        adminAttendanceFilter !== "all" ||
                        adminRatingFilter !== "all") && (
                        <button
                          type="button"
                          onClick={() => {
                            setAdminSearch("");
                            setAdminAttendanceFilter("all");
                            setAdminRatingFilter("all");
                          }}
                          className="ml-auto text-xs font-semibold text-rose-300 underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {loadingEntries ? (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center">
                    <svg
                      className="mx-auto h-12 w-12 animate-spin text-[#d4af37]"
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
                    <p className="mt-4 text-white/70">Loading love notes...</p>
                  </div>
                ) : (
                  <>
                    {/* OVERVIEW */}
                    {adminTab === "overview" && (
                      <div className="grid gap-6 lg:grid-cols-2">
                        <section className="rounded-3xl border border-white/10 bg-white/10 p-5">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            Attendance breakdown
                          </h2>
                          <div className="mt-4 space-y-3">
                            {Object.keys(adminStats.attendanceMap).length ===
                            0 ? (
                              <p className="text-sm text-white/50">
                                No data yet — waiting for the first guest.
                              </p>
                            ) : (
                              Object.entries(adminStats.attendanceMap)
                                .sort((a, b) => b[1] - a[1])
                                .map(([label, count]) => {
                                  const pct =
                                    adminStats.total === 0
                                      ? 0
                                      : Math.round(
                                          (count / adminStats.total) * 100
                                        );
                                  return (
                                    <div key={label}>
                                      <div className="mb-1 flex justify-between text-sm">
                                        <span className="text-white/90">
                                          {label}
                                        </span>
                                        <span className="text-[#d4af37] font-semibold">
                                          {count} · {pct}%
                                        </span>
                                      </div>
                                      <div className="h-2 rounded-full bg-white/10">
                                        <div
                                          className="h-2 rounded-full bg-gradient-to-r from-[#6b0f1a] to-[#d4af37]"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })
                            )}
                          </div>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/10 p-5">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            Top relations
                          </h2>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.keys(adminStats.relationMap).length === 0 ? (
                              <p className="text-sm text-white/50">
                                Relations will appear here.
                              </p>
                            ) : (
                              Object.entries(adminStats.relationMap)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 12)
                                .map(([label, count]) => (
                                  <span
                                    key={label}
                                    className="rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-1.5 text-xs font-semibold text-[#f5e6c8]"
                                  >
                                    {label} · {count}
                                  </span>
                                ))
                            )}
                          </div>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/10 p-5">
                          <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-[#f5e6c8]">
                              Highest vibes
                            </h2>
                            <button
                              type="button"
                              onClick={() => setAdminTab("guests")}
                              className="text-xs font-semibold text-[#d4af37] hover:underline"
                            >
                              View all →
                            </button>
                          </div>
                          <div className="mt-4 space-y-2">
                            {adminStats.topRated.length === 0 ? (
                              <p className="text-sm text-white/50">
                                No ratings yet.
                              </p>
                            ) : (
                              adminStats.topRated.map((e) => (
                                <button
                                  key={e.id}
                                  type="button"
                                  onClick={() => {
                                    setAdminTab("guests");
                                    setExpandedEntryId(e.id);
                                  }}
                                  className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
                                >
                                  <span className="truncate font-semibold text-white">
                                    {e.names}
                                  </span>
                                  <span className="ml-3 shrink-0 text-sm font-bold text-yellow-300">
                                    ⭐ {e.rating}/10
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/10 p-5">
                          <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-[#f5e6c8]">
                              Latest arrivals
                            </h2>
                            <button
                              type="button"
                              onClick={() => setAdminTab("guests")}
                              className="text-xs font-semibold text-[#d4af37] hover:underline"
                            >
                              View all →
                            </button>
                          </div>
                          <div className="mt-4 space-y-2">
                            {adminStats.latest.length === 0 ? (
                              <p className="text-sm text-white/50">
                                Waiting for the first message…
                              </p>
                            ) : (
                              adminStats.latest.map((e) => (
                                <button
                                  key={e.id}
                                  type="button"
                                  onClick={() => {
                                    setAdminTab("guests");
                                    setExpandedEntryId(e.id);
                                  }}
                                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-white">
                                      {e.names}
                                    </p>
                                    <p className="truncate text-xs text-white/50">
                                      {e.highlight || e.story || e.relation}
                                    </p>
                                  </div>
                                  <span className="shrink-0 text-[10px] text-white/40">
                                    {formatEntryDate(e.createdAt)}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </section>

                        {adminStats.starredCount > 0 && (
                          <section className="lg:col-span-2 rounded-3xl border border-[#d4af37]/40 bg-gradient-to-r from-[#d4af37]/15 to-white/5 p-5">
                            <h2 className="text-lg font-semibold text-[#f5e6c8]">
                              ★ Your starred keepsakes
                            </h2>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {guestEntries
                                .filter((e) => starredIds.includes(e.id))
                                .map((e) => (
                                  <button
                                    key={e.id}
                                    type="button"
                                    onClick={() => {
                                      setAdminTab("guests");
                                      setAdminRatingFilter("starred");
                                      setExpandedEntryId(e.id);
                                    }}
                                    className="rounded-full border border-[#d4af37]/40 bg-[#4b0c14]/60 px-4 py-2 text-sm font-semibold text-[#f5e6c8] transition hover:bg-[#6b0f1a]"
                                  >
                                    {e.names}
                                  </button>
                                ))}
                            </div>
                          </section>
                        )}
                      </div>
                    )}

                    {/* GUESTS */}
                    {adminTab === "guests" && (
                      <div className="space-y-4">
                        {guestEntries.length === 0 ? (
                          <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center">
                            <p className="text-lg text-white/70">
                              📭 No guest submissions yet
                            </p>
                            <p className="mt-2 text-sm text-white/50">
                              Share the portal link and love notes will land here.
                            </p>
                          </div>
                        ) : filteredEntries.length === 0 ? (
                          <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center">
                            <p className="text-lg text-white/70">
                              No matches for these filters
                            </p>
                          </div>
                        ) : (
                          filteredEntries.map((entry, idx) =>
                            renderEntryCard(entry, idx)
                          )
                        )}
                      </div>
                    )}

                    {/* LOVE BOARD */}
                    {adminTab === "loveboard" && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-[#d4af37]/30 bg-gradient-to-r from-[#6b0f1a]/60 to-transparent p-5">
                          <h2 className="text-xl font-semibold text-[#f5e6c8]">
                            ✨ Love board
                          </h2>
                          <p className="mt-1 text-sm text-white/70">
                            A romantic wall of guest stories, favorite moments &
                            wishes — perfect for printing or reading together.
                          </p>
                        </div>
                        {filteredEntries.filter(
                          (e) => e.story || e.highlight || e.suggestions
                        ).length === 0 ? (
                          <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center text-white/60">
                            No love notes yet.
                          </div>
                        ) : (
                          <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
                            {filteredEntries
                              .filter(
                                (e) =>
                                  e.story || e.highlight || e.suggestions
                              )
                              .map((e) => (
                                <article
                                  key={e.id}
                                  className="mb-4 break-inside-avoid rounded-2xl border border-[#d4af37]/25 bg-gradient-to-br from-white/10 to-white/5 p-5"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="font-semibold text-white">
                                        {e.names}
                                      </p>
                                      <p className="text-xs text-[#d4af37]">
                                        {e.relation}
                                        {e.rating
                                          ? ` · ⭐ ${e.rating}/10`
                                          : ""}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => toggleStarred(e.id)}
                                      className="text-[#d4af37]"
                                    >
                                      {starredIds.includes(e.id) ? "★" : "☆"}
                                    </button>
                                  </div>
                                  {e.highlight && (
                                    <p className="mt-3 text-sm italic text-[#f5e6c8]/90">
                                      “{e.highlight}”
                                    </p>
                                  )}
                                  {e.story && (
                                    <p className="mt-3 text-sm leading-relaxed text-white/85 whitespace-pre-wrap">
                                      {e.story}
                                    </p>
                                  )}
                                  {e.suggestions && (
                                    <p className="mt-3 rounded-xl bg-black/20 px-3 py-2 text-xs text-white/70">
                                      💫 {e.suggestions}
                                    </p>
                                  )}
                                  <p className="mt-3 text-[10px] text-white/40">
                                    {formatEntryDate(e.createdAt)}
                                  </p>
                                </article>
                              ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* MEDIA INDEX */}
                    {adminTab === "media" && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-white/10 p-5">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            📁 Media index
                          </h2>
                          <p className="mt-1 text-sm text-white/60">
                            Every file key guests uploaded, grouped with who sent
                            it. {adminStats.mediaCount} file
                            {adminStats.mediaCount === 1 ? "" : "s"} across{" "}
                            {adminStats.withMedia} guest
                            {adminStats.withMedia === 1 ? "" : "s"}.
                          </p>
                        </div>
                        {adminStats.mediaRows.length === 0 ? (
                          <div className="rounded-3xl border border-white/10 bg-white/10 p-12 text-center text-white/60">
                            No media uploaded yet.
                          </div>
                        ) : (
                          <div className="overflow-hidden rounded-2xl border border-white/10">
                            <div className="max-h-[28rem] overflow-auto">
                              <table className="w-full text-left text-sm">
                                <thead className="sticky top-0 bg-[#4b0c14] text-xs uppercase tracking-wider text-[#f5e6c8]">
                                  <tr>
                                    <th className="px-4 py-3">File key</th>
                                    <th className="px-4 py-3">Guest</th>
                                    <th className="px-4 py-3">When</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {adminStats.mediaRows
                                    .filter((row) => {
                                      const q = adminSearch.trim().toLowerCase();
                                      if (!q) return true;
                                      return (
                                        row.key.toLowerCase().includes(q) ||
                                        String(row.guest || "")
                                          .toLowerCase()
                                          .includes(q) ||
                                        String(row.email || "")
                                          .toLowerCase()
                                          .includes(q)
                                      );
                                    })
                                    .map((row, i) => (
                                      <tr
                                        key={`${row.entryId}-${i}`}
                                        className="border-t border-white/5 bg-white/5 odd:bg-white/[0.07] hover:bg-white/10"
                                      >
                                        <td className="max-w-[280px] truncate px-4 py-3 font-mono text-xs text-white/80">
                                          {row.key}
                                        </td>
                                        <td className="px-4 py-3 text-white">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setAdminTab("guests");
                                              setExpandedEntryId(row.entryId);
                                            }}
                                            className="font-semibold hover:text-[#d4af37]"
                                          >
                                            {row.guest}
                                          </button>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-xs text-white/50">
                                          {formatEntryDate(row.createdAt)}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* TOOLS */}
                    {adminTab === "tools" && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <section className="md:col-span-2 rounded-3xl border border-[#d4af37]/30 bg-gradient-to-br from-[#6b0f1a]/40 to-white/5 p-6">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            🔐 Account security
                          </h2>
                          <p className="mt-1 text-sm text-white/60">
                            Signed in as{" "}
                            <span className="font-semibold text-[#d4af37]">
                              {adminSessionEmail}
                            </span>
                            . Each authorized email keeps its own password — you
                            can both stay signed in on different devices.
                          </p>
                          {adminAuthError && adminAuthed && (
                            <div className="mt-3 rounded-xl border border-rose-400/40 bg-rose-900/30 px-4 py-3 text-sm text-rose-200">
                              {adminAuthError}
                            </div>
                          )}
                          {adminAuthInfo && adminAuthed && (
                            <div className="mt-3 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 py-3 text-sm text-[#f5e6c8]">
                              {adminAuthInfo}
                            </div>
                          )}
                          <form
                            onSubmit={handleOptionalPasswordChange}
                            className="mt-4 grid gap-3 md:grid-cols-3"
                          >
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-semibold text-[#f5e6c8]">
                                Current password
                              </span>
                              <input
                                type="password"
                                value={changeCurrentPassword}
                                onChange={(e) =>
                                  setChangeCurrentPassword(e.target.value)
                                }
                                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                                required
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-semibold text-[#f5e6c8]">
                                New password
                              </span>
                              <input
                                type="password"
                                value={changeNewPassword}
                                onChange={(e) =>
                                  setChangeNewPassword(e.target.value)
                                }
                                minLength={8}
                                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                                required
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-semibold text-[#f5e6c8]">
                                Confirm new password
                              </span>
                              <input
                                type="password"
                                value={changeConfirmPassword}
                                onChange={(e) =>
                                  setChangeConfirmPassword(e.target.value)
                                }
                                minLength={8}
                                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                                required
                              />
                            </label>
                            <div className="md:col-span-3">
                              <button
                                type="submit"
                                className="rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-2.5 text-sm font-semibold text-[#4b0c14]"
                              >
                                Update password
                              </button>
                            </div>
                          </form>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/10 p-6">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            Export keepsakes
                          </h2>
                          <p className="mt-2 text-sm text-white/60">
                            Download the currently filtered guest list (
                            {filteredEntries.length} of {adminStats.total}) as a
                            spreadsheet or backup file.
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => exportEntriesCsv(filteredEntries)}
                              className="rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8962e] px-4 py-2.5 text-sm font-semibold text-[#4b0c14]"
                            >
                              Export CSV
                            </button>
                            <button
                              type="button"
                              onClick={() => exportEntriesJson(filteredEntries)}
                              className="rounded-xl border border-[#d4af37]/40 px-4 py-2.5 text-sm font-semibold text-[#f5e6c8]"
                            >
                              Export JSON
                            </button>
                            <button
                              type="button"
                              onClick={() => exportEntriesCsv(guestEntries)}
                              className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white"
                            >
                              Export all CSV
                            </button>
                          </div>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/10 p-6">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            Thank-you blast helpers
                          </h2>
                          <p className="mt-2 text-sm text-white/60">
                            Copy every guest email (with an address) for a group
                            thank-you message.
                          </p>
                          <button
                            type="button"
                            onClick={async () => {
                              const emails = guestEntries
                                .map((e) => e.email)
                                .filter(Boolean)
                                .join(", ");
                              if (!emails) {
                                alert("No guest emails collected yet.");
                                return;
                              }
                              try {
                                await navigator.clipboard.writeText(emails);
                                alert("Emails copied to clipboard!");
                              } catch {
                                alert(emails);
                              }
                            }}
                            className="mt-4 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
                          >
                            📋 Copy all emails
                          </button>
                          <p className="mt-3 text-xs text-white/40">
                            {
                              guestEntries.filter((e) => e.email).length
                            }{" "}
                            guests shared an email.
                          </p>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/10 p-6">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            Local favorites & notes
                          </h2>
                          <p className="mt-2 text-sm text-white/60">
                            Stars and private notes are saved in this browser only
                            (not on the server). Clear them if you switch devices
                            or want a fresh start.
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Clear all starred favorites on this device?"
                                  )
                                ) {
                                  persistStarred([]);
                                }
                              }}
                              className="rounded-xl bg-rose-600/20 px-4 py-2.5 text-sm font-semibold text-rose-300"
                            >
                              Clear stars
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Clear all private admin notes on this device?"
                                  )
                                ) {
                                  setAdminNotes({});
                                  try {
                                    localStorage.removeItem(
                                      "wedding-admin-notes"
                                    );
                                  } catch {
                                    /* ignore */
                                  }
                                }
                              }}
                              className="rounded-xl bg-rose-600/20 px-4 py-2.5 text-sm font-semibold text-rose-300"
                            >
                              Clear notes
                            </button>
                          </div>
                        </section>

                        <section className="rounded-3xl border border-[#d4af37]/30 bg-gradient-to-br from-[#6b0f1a]/50 to-white/5 p-6">
                          <h2 className="text-lg font-semibold text-[#f5e6c8]">
                            Quick print love sheet
                          </h2>
                          <p className="mt-2 text-sm text-white/60">
                            Open a clean printable page of the filtered love notes
                            (great for a scrapbook or reception display).
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const notes = filteredEntries.filter(
                                (e) => e.story || e.highlight
                              );
                              const html = `<!doctype html><html><head><title>Love Notes · Olanrewaju & Dolapo</title>
<style>
  body{font-family:Georgia,serif;background:#f5e6c8;color:#4b0c14;padding:40px;max-width:800px;margin:auto}
  h1{color:#6b0f1a;border-bottom:2px solid #d4af37;padding-bottom:8px}
  .card{background:#fffdf8;border:1px solid #d4af37;border-radius:16px;padding:20px;margin:16px 0;page-break-inside:avoid}
  .meta{color:#6b0f1a;font-size:12px;opacity:.7}
  .hl{font-style:italic;color:#6b0f1a}
  .tags{margin-top:24px;color:#6b0f1a;font-size:12px}
</style></head><body>
<h1>Olanrewaju & Dolapo</h1>
<p>Love notes from our people · #morenikeji #dolan26 #TheFashinas</p>
${notes
  .map(
    (e) => `<div class="card">
  <strong>${String(e.names || "").replace(/</g, "&lt;")}</strong>
  <div class="meta">${String(e.relation || "").replace(/</g, "&lt;")} · ⭐ ${e.rating}/10</div>
  ${e.highlight ? `<p class="hl">“${String(e.highlight).replace(/</g, "&lt;")}”</p>` : ""}
  ${e.story ? `<p>${String(e.story).replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>` : ""}
</div>`
  )
  .join("")}
<p class="tags">With love · The Fashinas</p>
<script>window.onload=()=>window.print()</script>
</body></html>`;
                              const w = window.open("", "_blank");
                              if (w) {
                                w.document.write(html);
                                w.document.close();
                              }
                            }}
                            className="mt-4 rounded-xl bg-gradient-to-r from-[#f5e6c8] to-[#d4af37] px-4 py-2.5 text-sm font-semibold text-[#4b0c14]"
                          >
                            🖨️ Print love sheet
                          </button>
                        </section>
                      </div>
                    )}
                  </>
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
          <header className="relative overflow-hidden flex flex-col gap-5 rounded-3xl border border-[#d4af37]/30 bg-gradient-to-br from-[#4b0c14]/90 via-[#6b0f1a]/80 to-[#2a0a10]/90 p-6 md:p-8 shadow-2xl shadow-black/40">
            {/* Soft romantic glow accents */}
            <div
              className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full opacity-30 blur-3xl"
              style={{ background: colors.gold }}
            />
            <div
              className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full opacity-20 blur-3xl"
              style={{ background: colors.champagne }}
            />

            <div className="relative flex flex-col items-center text-center gap-4">
              {/* Logo icon */}
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg ring-2 ring-[#d4af37]/40"
                style={{
                  background: `linear-gradient(135deg, ${colors.wine}, ${colors.gold})`,
                }}
              >
                <span className="text-3xl" aria-hidden>
                  💍
                </span>
              </div>

              <div className="w-full max-w-2xl">
                <p className="text-xs uppercase tracking-[0.28em] text-[#f5e6c8]/90">
                  ✨ Forever begins here ✨
                </p>
                <h1 className="mt-2 text-3xl md:text-4xl font-semibold text-white tracking-tight">
                  Olanrewaju <span className="text-[#d4af37]">&</span> Dolapo
                </h1>
                <p className="mt-2 text-sm md:text-base text-[#f5e6c8]/90 italic">
                  💕 Share your love notes, photos & the moments that made you
                  smile 📸
                </p>
              </div>

              {/* Nav tabs */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setActivePage("upload")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    activePage === "upload"
                      ? "bg-[#f5e6c8] text-[#6b0f1a] shadow-md"
                      : "bg-white/15 text-white hover:bg-white/25"
                  }`}
                >
                  💕 Share memories
                </button>
                <button
                  type="button"
                  onClick={() => setActivePage("gallery")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    activePage === "gallery"
                      ? "bg-[#f5e6c8] text-[#6b0f1a] shadow-md"
                      : "bg-white/15 text-white hover:bg-white/25"
                  }`}
                >
                  ✨ Gallery
                </button>

                <button
                  type="button"
                  onClick={() => setActivePage("admin")}
                  className="rounded-full bg-[#d4af37]/20 px-4 py-2 text-sm font-semibold text-[#f5e6c8] transition hover:bg-[#d4af37]/35"
                >
                  🔐 Admin
                </button>
              </div>

              {/* Stats cards */}
              <div className="flex flex-wrap items-stretch justify-center gap-3 text-slate-900">
                <div className="min-w-[140px] rounded-2xl bg-[#f5e6c8]/95 px-4 py-3 text-center shadow-lg ring-1 ring-[#d4af37]/40">
                  <p className="text-xs text-[#6b0f1a]/70">📸 Memories selected</p>
                  <p className="text-lg font-semibold text-[#4b0c14]">
                    {attachments.length || "0"} files
                  </p>
                  <p className="text-xs text-[#6b0f1a]/60">
                    {formatBytes(stats.totalBytes)}
                  </p>
                </div>
                <div className="min-w-[160px] max-w-[220px] rounded-2xl bg-white/95 px-4 py-3 text-center shadow-lg ring-1 ring-white/50">
                  <p className="text-xs text-slate-600">💫 Status</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {stats.done} uploaded
                  </p>
                  {stats.errors > 0 && (
                    <p className="text-xs font-semibold text-rose-600">
                      {stats.errors} failed
                    </p>
                  )}
                  <p
                    className="text-xs font-semibold p-1 break-words"
                    style={{ color: colors.wine }}
                  >
                    {statusMessage}
                  </p>
                </div>
              </div>
            </div>

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
                {/* Thank you & appreciation from the couple */}
                <div className="relative overflow-hidden rounded-3xl border border-[#d4af37]/40 bg-gradient-to-br from-[#6b0f1a]/95 via-[#4b0c14]/90 to-[#2a0a10] p-6 shadow-xl shadow-black/40 text-white text-center">
                  <div
                    className="pointer-events-none absolute -top-10 right-0 h-28 w-28 rounded-full opacity-25 blur-2xl"
                    style={{ background: colors.gold }}
                  />
                  <p className="relative text-2xl" aria-hidden>
                    💖 🥂 💍
                  </p>
                  <p className="relative mt-3 text-xs uppercase tracking-[0.28em] text-[#d4af37]">
                    💕 With all our hearts 💕
                  </p>
                  <h2 className="relative mt-3 text-2xl font-semibold text-[#f5e6c8] leading-snug">
                    🙏 Thank you for celebrating our love
                  </h2>
                  <p className="relative mt-3 text-sm leading-relaxed text-white/85">
                    From the bottom of our hearts — thank you for standing with
                    us, laughing with us, and filling our day with so much
                    warmth. ✨ Every photo, every word, every kind wish means the
                    world. We are endlessly grateful. 🥰
                  </p>
                  <p className="relative mt-4 text-sm italic text-[#f5e6c8]/90">
                    With love & appreciation always, 💐
                    <br />
                    <span className="not-italic font-semibold text-[#d4af37]">
                      Olanrewaju & Dolapo 💞
                    </span>
                  </p>
                  <div className="relative mt-4 flex flex-wrap items-center justify-center gap-2">
                    <span className="rounded-full border border-[#d4af37]/50 bg-[#d4af37]/15 px-3 py-1 text-xs font-semibold text-[#f5e6c8]">
                      ✨ #morenikeji
                    </span>
                    <span className="rounded-full border border-[#d4af37]/50 bg-[#d4af37]/15 px-3 py-1 text-xs font-semibold text-[#f5e6c8]">
                      💍 #dolan26
                    </span>
                    <span className="rounded-full border border-[#d4af37]/50 bg-[#d4af37]/15 px-3 py-1 text-xs font-semibold text-[#f5e6c8]">
                      🥂 #TheFashinas
                    </span>
                  </div>
                </div>

                <div className="rounded-3xl border border-[#d4af37]/25 bg-white/10 p-5 shadow-xl shadow-black/30 text-white/90 backdrop-blur-sm text-center">
                  <p className="text-2xl" aria-hidden>
                    📷 🎥 🌟
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-[#f5e6c8]">
                    🎞️ Memory gallery
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    Relive the magic together ✨
                  </h2>
                  <p className="mt-2 text-sm text-white/75">
                    Peek at the photos and videos you&apos;ve gathered, and
                    download the ones you want to keep forever. 💕
                  </p>
                  <button
                    type="button"
                    onClick={() => setActivePage("gallery")}
                    className="mt-4 rounded-xl bg-gradient-to-r from-[#f5e6c8] to-[#d4af37] px-4 py-3 text-sm font-semibold text-[#4b0c14] shadow-md transition hover:-translate-y-[1px] hover:shadow-lg"
                  >
                    🖼️ Open gallery & downloads
                  </button>
                </div>
              </aside>

              {/* Main form */}
              <main className="space-y-4 rounded-3xl border border-[#d4af37]/30 bg-gradient-to-b from-[#fffdf8] to-[#f5e6c8]/40 p-6 md:p-8 text-slate-900 shadow-2xl shadow-black/40">
                <div className="mb-2 border-b border-[#d4af37]/25 pb-4 text-center">
                  <p className="text-xs uppercase tracking-[0.24em] text-[#6b0f1a]/70">
                    💌 A note for the newlyweds
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-[#4b0c14]">
                    🥰 Leave your love, wishes & memories
                  </h2>
                  <p className="mt-1 text-sm text-[#6b0f1a]/70">
                    Your words and photos will be treasured forever. 💖
                  </p>
                </div>
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
                        placeholder="Olanrewaju & Dolapo"
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
                  <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[#d4af37]/35 bg-gradient-to-r from-[#f5e6c8] via-white to-[#f5e6c8] px-4 py-5 text-sm text-slate-800 shadow-inner text-center sm:flex-row sm:justify-between sm:text-left">
                    <div className="flex flex-col items-center gap-1 sm:items-start">
                      <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold sm:justify-start">
                        <span className="rounded-full bg-[#6b0f1a] px-3 py-1.5 text-[#f5e6c8] ring-1 ring-[#d4af37]/50">
                          ✨ #morenikeji
                        </span>
                        <span className="rounded-full bg-[#6b0f1a] px-3 py-1.5 text-[#f5e6c8] ring-1 ring-[#d4af37]/50">
                          💍 #dolan26
                        </span>
                        <span className="rounded-full bg-[#6b0f1a] px-3 py-1.5 text-[#f5e6c8] ring-1 ring-[#d4af37]/50">
                          🥂 #TheFashinas
                        </span>
                      </div>
                      <p className="text-xs text-[#6b0f1a]/70 italic">
                        💖 Your love means everything to us 💕
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-[#d4af37] focus:ring-offset-2 focus:ring-offset-white disabled:opacity-60 disabled:cursor-not-allowed"
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
                          Sending with love... 💌
                        </>
                      ) : (
                        <>
                          💕 Send love & memories
                          <span aria-hidden>🥰</span>
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