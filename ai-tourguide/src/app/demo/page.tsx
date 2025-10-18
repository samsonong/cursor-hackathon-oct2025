"use client";

import { getWakeWord } from "@/lib/wake-word";

export default function DemoSplashPage() {
  const activeWakeWord = getWakeWord();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 px-6 text-center text-slate-100">
      <div className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
          Currently exploring
          <span className="text-emerald-100">Changi Jewel</span>
        </span>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Jewel Changi holds the stage
        </h1>
      </div>
      <div className="space-y-2 text-sm text-slate-300">
        <p>
          When you&rsquo;re ready to chat, just say
          <span className="mx-1 rounded-sm bg-slate-900 px-1.5 py-0.5 font-semibold text-slate-100">
            “{activeWakeWord}”
          </span>
          !
        </p>
      </div>
    </div>
  );
}
