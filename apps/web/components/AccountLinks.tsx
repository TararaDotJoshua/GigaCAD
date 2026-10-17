"use client";

import { useEffect, useState } from "react";
import { dashboardPath } from "../lib/hosts";
import { readSignedIn } from "../lib/signed-in";
import { APP_URL } from "./site";

/** Whether the app says you're signed in. False until the page has loaded, so it renders the same as the server. */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(readSignedIn()), []);
  return signedIn;
}

const DASHBOARD_URL = `${APP_URL.replace(/\/$/, "")}${dashboardPath()}`;

/** The header's account actions: Log in and Start a project, or a way back to your projects. */
export function HeaderAccount() {
  const signedIn = useSignedIn();
  if (signedIn)
    return (
      <a className="button button-small" href={DASHBOARD_URL}>
        Your projects
      </a>
    );
  return (
    <>
      <a className="nav-login" href={`${APP_URL}/login`}>
        Log in
      </a>
      <a className="button button-small" href={`${APP_URL}/signup`}>
        Start a project
      </a>
    </>
  );
}

/** The account link in the phone menu and the footer. */
export function AccountLink({ className }: { className?: string }) {
  const signedIn = useSignedIn();
  return (
    <a className={className} href={signedIn ? DASHBOARD_URL : `${APP_URL}/login`}>
      {signedIn ? "Your projects" : "Log in"}
    </a>
  );
}
