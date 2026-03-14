"use client";

import dynamic from "next/dynamic";

const MainShell = dynamic(
  () => import("./main-shell").then((module) => module.MainShell),
  { ssr: false }
);

export function MainShellClient() {
  return <MainShell />;
}
