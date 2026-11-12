import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

const allowedOtpTypes: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
  "sms",
  "phone_change",
];

export async function completeAuthFromUrl(url: string): Promise<void> {
  if (!supabase) return;

  try {
    const parsed = new URL(url);
    const query = parsed.searchParams;
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));

    const code = query.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return;
    }

    const tokenHash = query.get("token_hash");
    const otpType = query.get("type");
    if (tokenHash && otpType && allowedOtpTypes.includes(otpType as EmailOtpType)) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType as EmailOtpType,
      });
      if (error) throw error;
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }
  } catch (error) {
    console.warn("ChitChat auth callback could not be completed.", error);
  }
}
