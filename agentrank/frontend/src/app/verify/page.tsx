import { redirect } from "next/navigation";

// The rater flow is now part of the unified, connect-wallet "Verify Wallet" page
// (no more manual address entry). Old links land here and forward on.
export default function VerifyRedirect() {
  redirect("/verify-wallet");
}
