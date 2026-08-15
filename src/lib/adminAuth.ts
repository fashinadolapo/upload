import {
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  updatePassword,
  resetPassword,
  confirmResetPassword,
  confirmSignIn,
  type SignInOutput,
} from "aws-amplify/auth";
import {
  DEFAULT_ADMIN_PASSWORD,
  isAllowedAdminEmail,
  normalizeEmail,
} from "@/config/constants";

const MUST_CHANGE_KEY = "wedding-admin-must-change-v1";

export type AdminAuthResult =
  | { status: "authenticated"; email: string; mustChangePassword: boolean }
  | { status: "confirmSignIn"; step: string }
  | { status: "error"; message: string };

function friendlyAuthError(error: unknown): string {
  const err = error as { name?: string; message?: string };
  const name = err?.name || "";
  const message = err?.message || "Something went wrong. Please try again.";

  switch (name) {
    case "NotAuthorizedException":
      return "Incorrect email or password.";
    case "UserNotFoundException":
      return "No vault account found for this email. Create access first.";
    case "UsernameExistsException":
      return "An account already exists for this email. Please sign in.";
    case "InvalidPasswordException":
      return "Password does not meet security requirements (min 8 characters, include a letter and a number).";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Please wait a moment and try again.";
    case "CodeMismatchException":
      return "Invalid recovery code. Check the email and try again.";
    case "ExpiredCodeException":
      return "Recovery code expired. Request a new one.";
    case "InvalidParameterException":
      return message.includes("email")
        ? "Enter a valid authorized email address."
        : message;
    case "UserNotConfirmedException":
      return "Account is not confirmed yet. Contact support or try again shortly.";
    default:
      if (message.toLowerCase().includes("network")) {
        return "Network error. Check your connection and try again.";
      }
      return message;
  }
}

export function markMustChangePassword(email: string, value: boolean) {
  const key = normalizeEmail(email);
  try {
    const raw = localStorage.getItem(MUST_CHANGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    if (value) map[key] = true;
    else delete map[key];
    localStorage.setItem(MUST_CHANGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function needsPasswordChange(email: string): boolean {
  try {
    const raw = localStorage.getItem(MUST_CHANGE_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return Boolean(map[normalizeEmail(email)]);
  } catch {
    return false;
  }
}

async function resolveSignedInEmail(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload as
      | Record<string, unknown>
      | undefined;
    const email =
      (payload?.email as string | undefined) ||
      (payload?.["cognito:username"] as string | undefined);
    if (email && isAllowedAdminEmail(email)) return normalizeEmail(email);

    const user = await getCurrentUser();
    if (user?.signInDetails?.loginId && isAllowedAdminEmail(user.signInDetails.loginId)) {
      return normalizeEmail(user.signInDetails.loginId);
    }
    if (user?.username && isAllowedAdminEmail(user.username)) {
      return normalizeEmail(user.username);
    }
    return email ? normalizeEmail(email) : null;
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<{
  email: string;
  mustChangePassword: boolean;
} | null> {
  try {
    await getCurrentUser();
    const email = await resolveSignedInEmail();
    if (!email || !isAllowedAdminEmail(email)) {
      await safeSignOut();
      return null;
    }
    return {
      email,
      mustChangePassword: needsPasswordChange(email),
    };
  } catch {
    return null;
  }
}

export async function safeSignOut() {
  try {
    await signOut();
  } catch {
    /* already signed out */
  }
}

function afterSuccessfulAuth(
  email: string,
  passwordUsed?: string
): AdminAuthResult {
  const normalized = normalizeEmail(email);
  const usedDefault =
    passwordUsed != null && passwordUsed === DEFAULT_ADMIN_PASSWORD;
  if (usedDefault) {
    markMustChangePassword(normalized, true);
  }
  return {
    status: "authenticated",
    email: normalized,
    mustChangePassword: needsPasswordChange(normalized) || usedDefault,
  };
}

export async function adminSignIn(
  emailInput: string,
  password: string
): Promise<AdminAuthResult> {
  const email = normalizeEmail(emailInput);

  if (!email || !password) {
    return { status: "error", message: "Enter your admin email and password." };
  }
  if (!isAllowedAdminEmail(email)) {
    return {
      status: "error",
      message: "This email is not authorized for the couple's vault.",
    };
  }

  try {
    // Clear any stale session before a fresh sign-in attempt.
    await safeSignOut();

    const result: SignInOutput = await signIn({
      username: email,
      password,
    });

    if (
      result.nextStep?.signInStep ===
      "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
    ) {
      return { status: "confirmSignIn", step: result.nextStep.signInStep };
    }

    if (result.isSignedIn) {
      return afterSuccessfulAuth(email, password);
    }

    return {
      status: "error",
      message: `Additional verification required (${result.nextStep?.signInStep || "unknown"}).`,
    };
  } catch (error) {
    const err = error as { name?: string };
    // First-time couple access: auto-provision allowlisted account with the
    // shared bootstrap password, then force a password change.
    if (
      err?.name === "UserNotFoundException" &&
      password === DEFAULT_ADMIN_PASSWORD
    ) {
      const created = await adminBootstrapSignUp(email, password);
      if (created.status !== "authenticated") return created;
      // Sign in after sign-up
      return adminSignIn(email, password);
    }
    return { status: "error", message: friendlyAuthError(error) };
  }
}

export async function completeNewPassword(
  newPassword: string
): Promise<AdminAuthResult> {
  try {
    if (newPassword.length < 8) {
      return {
        status: "error",
        message: "New password must be at least 8 characters.",
      };
    }
    if (newPassword === DEFAULT_ADMIN_PASSWORD) {
      return {
        status: "error",
        message: "Please choose something other than the default password.",
      };
    }

    const result = await confirmSignIn({ challengeResponse: newPassword });
    if (!result.isSignedIn) {
      return {
        status: "error",
        message: "Could not complete password challenge. Try signing in again.",
      };
    }

    const email = (await resolveSignedInEmail()) || "";
    if (!email || !isAllowedAdminEmail(email)) {
      await safeSignOut();
      return {
        status: "error",
        message: "This account is not authorized for the couple's vault.",
      };
    }
    markMustChangePassword(email, false);
    return {
      status: "authenticated",
      email,
      mustChangePassword: false,
    };
  } catch (error) {
    return { status: "error", message: friendlyAuthError(error) };
  }
}

export async function adminBootstrapSignUp(
  emailInput: string,
  password: string
): Promise<AdminAuthResult> {
  const email = normalizeEmail(emailInput);
  if (!isAllowedAdminEmail(email)) {
    return {
      status: "error",
      message: "This email is not authorized for the couple's vault.",
    };
  }
  if (password.length < 8) {
    return {
      status: "error",
      message: "Password must be at least 8 characters.",
    };
  }

  try {
    await signUp({
      username: email,
      password,
      options: {
        userAttributes: { email },
      },
    });
    markMustChangePassword(email, true);
    return {
      status: "authenticated",
      email,
      mustChangePassword: true,
    };
  } catch (error) {
    return { status: "error", message: friendlyAuthError(error) };
  }
}

export async function adminChangePassword(
  oldPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (newPassword.length < 8) {
    return { ok: false, message: "New password must be at least 8 characters." };
  }
  if (newPassword === DEFAULT_ADMIN_PASSWORD) {
    return {
      ok: false,
      message: "Please choose something other than the default password.",
    };
  }
  if (newPassword === oldPassword) {
    return {
      ok: false,
      message: "New password must be different from the current one.",
    };
  }

  try {
    await updatePassword({ oldPassword, newPassword });
    const email = await resolveSignedInEmail();
    if (email) markMustChangePassword(email, false);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: friendlyAuthError(error) };
  }
}

export async function adminRequestPasswordReset(
  emailInput: string
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const email = normalizeEmail(emailInput);
  if (!email) {
    return { ok: false, message: "Enter your admin email." };
  }
  if (!isAllowedAdminEmail(email)) {
    // Do not reveal allowlist membership.
    return {
      ok: true,
      message:
        "If this email is authorized, a recovery code has been sent.",
    };
  }

  try {
    const output = await resetPassword({ username: email });
    const delivery = output.nextStep.codeDeliveryDetails;
    const dest = delivery?.destination || "your email";
    return {
      ok: true,
      message: `If an account exists, a recovery code was sent to ${dest}.`,
    };
  } catch (error) {
    const err = error as { name?: string };
    if (err?.name === "UserNotFoundException") {
      return {
        ok: true,
        message:
          "If this email is authorized, a recovery code has been sent.",
      };
    }
    return { ok: false, message: friendlyAuthError(error) };
  }
}

export async function adminConfirmPasswordReset(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const email = normalizeEmail(input.email);
  if (!isAllowedAdminEmail(email)) {
    return { ok: false, message: "This email is not authorized." };
  }
  if (input.newPassword.length < 8) {
    return { ok: false, message: "New password must be at least 8 characters." };
  }
  if (input.newPassword === DEFAULT_ADMIN_PASSWORD) {
    return {
      ok: false,
      message: "Please choose something other than the default password.",
    };
  }

  try {
    await confirmResetPassword({
      username: email,
      confirmationCode: input.code.trim(),
      newPassword: input.newPassword,
    });
    markMustChangePassword(email, false);
    return {
      ok: true,
      message: "Password updated. Sign in with your email and new password.",
    };
  } catch (error) {
    return { ok: false, message: friendlyAuthError(error) };
  }
}
