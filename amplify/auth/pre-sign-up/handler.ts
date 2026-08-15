import type { PreSignUpTriggerHandler } from "aws-lambda";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = normalizeEmail(event.request.userAttributes?.email || "");
  // Amplify injects ALLOWED_ADMIN_EMAILS at deploy time from the function resource.
  const allowed = String(process.env.ALLOWED_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);

  if (!email || !allowed.includes(email)) {
    throw new Error(
      "This email is not authorized to create a couple vault account."
    );
  }

  // Couple emails only — confirm immediately so both can log in without a
  // separate verification step after allowlisted sign-up.
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;

  return event;
};
