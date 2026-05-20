"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// The protocol-launch worker pulls lib/protocol-handlers/{mailto,webcal,session}.ts
// (~528 LOC combined) plus i18n + settings-store wiring. The provider
// wraps the entire authenticated tree from app/[locale]/layout.tsx, so
// importing the worker eagerly would put the whole protocol-handling
// stack on every authenticated route's cold-load. The only thing the
// provider does is render children + set up two useEffects — those
// effects can run a tick later without breaking mailto/webcal handling
// (the launchQueue consumer registers idempotently and the request
// listener picks up retries via session storage).
const ProtocolLaunchHandlerWorker = dynamic(
  () => import("./protocol-launch-handler-worker").then(m => ({ default: m.ProtocolLaunchHandlerWorker })),
  { ssr: false, loading: () => null },
);

interface ProtocolLaunchHandlerProviderProps {
  children: ReactNode;
}

export function ProtocolLaunchHandlerProvider({ children }: ProtocolLaunchHandlerProviderProps) {
  return (
    <>
      <ProtocolLaunchHandlerWorker />
      {children}
    </>
  );
}
