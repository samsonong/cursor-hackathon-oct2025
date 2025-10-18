"use client";

import { useMemo, useState } from "react";

import { narratePointOfInterestAction } from "@/app/actions/narrate-point-of-interest";
import { userPreferences } from "@/data/user-preferences";
import {
  changiJewelKnowledgeBase,
  changiJewelMain,
  changiJewelRainVortext,
} from "@/data/changi-jewel";
import {
  PlaceOfInterest,
  generateStorytellingForPlaceOfInterest,
  narrateToUser,
  prepareUserPreferences,
} from "@/lib/storytelling";

type NarrationEntry = {
  poiId: string;
  poiName: string;
  story: string;
  timestamp: number;
};

const poiCatalog: PlaceOfInterest[] = [changiJewelMain, changiJewelRainVortext];
const preparedPreferences = prepareUserPreferences(userPreferences);

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp).toLocaleTimeString();
}

export default function StorytellerPage() {
  const [selectedPoiId, setSelectedPoiId] = useState<string>(
    poiCatalog[0]?.id ?? ""
  );
  const [latestStory, setLatestStory] = useState<string>("");
  const [isNarrating, setIsNarrating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [narrationLog, setNarrationLog] = useState<NarrationEntry[]>([]);
  const knowledge = changiJewelKnowledgeBase;
  const overviewBullets = knowledge.overview.bullets?.slice(0, 3) ?? [];
  const quickFactCards = knowledge.quickFacts.slice(0, 6);
  const historyHighlights = knowledge.history.slice(0, 4);
  const featuredFaqs = knowledge.faqs.slice(0, 3);
  const personaExtras = preparedPreferences.extras;
  const hasPersonaExtras = Object.keys(personaExtras).length > 0;

  const toneDisplay = (() => {
    const rawTone =
      typeof userPreferences.preferredTone === "string"
        ? userPreferences.preferredTone.trim()
        : "";
    const normalized = preparedPreferences.preferredTone;
    if (rawTone && rawTone.toLowerCase() !== normalized) {
      return `${toTitleCase(rawTone)} → ${toTitleCase(normalized)}`;
    }
    return toTitleCase(normalized);
  })();

  const paceDisplay = (() => {
    const rawPace =
      typeof userPreferences.preferredPace === "string"
        ? userPreferences.preferredPace.trim()
        : "";
    const normalized = preparedPreferences.preferredPace;
    if (rawPace && rawPace.toLowerCase() !== normalized) {
      return `${toTitleCase(rawPace)} → ${toTitleCase(normalized)}`;
    }
    return toTitleCase(normalized);
  })();

  const selectedPoi = useMemo(() => {
    return poiCatalog.find((poi) => poi.id === selectedPoiId) ?? null;
  }, [selectedPoiId]);

  const recordNarration = (story: string, poi: PlaceOfInterest) => {
    setLatestStory(story);
    setNarrationLog((prev) =>
      [
        {
          poiId: poi.id,
          poiName: poi.name,
          story,
          timestamp: Date.now(),
        },
        ...prev,
      ].slice(0, 12)
    );
  };

  const speakPointOfInterest = async () => {
    if (!selectedPoi) {
      setError("Select a point of interest to continue.");
      return;
    }

    setError(null);
    setIsNarrating(true);

    try {
      const story = await narratePointOfInterestAction({
        poi: selectedPoi,
        preferences: userPreferences,
      });

      recordNarration(story, selectedPoi);
      await narrateToUser(story);
    } catch (untypedError) {
      console.error("AI narration failed", untypedError);

      const fallbackStory = generateStorytellingForPlaceOfInterest(
        userPreferences,
        selectedPoi
      );

      recordNarration(fallbackStory, selectedPoi);

      const message =
        untypedError instanceof Error
          ? `AI narrator unavailable. Showing template narration instead. (${untypedError.message})`
          : "AI narrator unavailable. Showing template narration instead.";

      setError(message);
      await narrateToUser(fallbackStory);
    } finally {
      setIsNarrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-10">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold sm:text-4xl">
              AI Tour Guide Story Studio
            </h1>
            <p className="text-sm text-slate-400 sm:text-base">
              Craft narrated micro-adventures for Changi Jewel at the tap of a
              button—no live geofencing required.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-xl font-semibold">Story controls</h2>
                <p className="text-sm text-slate-400">
                  Pick a landmark inside Changi Jewel, then generate a tailored
                  narration using the traveller’s preferences.
                </p>
              </div>

              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Point of interest
                <select
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={selectedPoiId}
                  onChange={(event) => setSelectedPoiId(event.target.value)}
                  aria-label="Point of interest"
                >
                  {poiCatalog.map((poi) => (
                    <option key={poi.id} value={poi.id}>
                      {poi.name}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPoi ? (
                <div className="rounded-xl border border-slate-800/60 bg-slate-950/70 p-4 text-sm text-slate-300">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {selectedPoi.name}
                  </h3>
                  <p className="mt-2 text-slate-400">{selectedPoi.summary}</p>
                  <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Highlights
                  </h4>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-400">
                    {selectedPoi.highlights.map((highlight) => (
                      <li key={highlight}>{highlight}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <button
                type="button"
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 disabled:cursor-not-allowed disabled:bg-emerald-700/60"
                onClick={speakPointOfInterest}
                disabled={isNarrating || !selectedPoi}
              >
                {isNarrating ? "Narrating..." : "Speak point of interest"}
              </button>

              {error ? <p className="text-xs text-rose-300">{error}</p> : null}
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold">Traveller profile</h2>
            <dl className="mt-4 space-y-2 text-sm text-slate-300">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Name</dt>
                <dd className="font-medium text-slate-100">
                  {userPreferences.travelerName ??
                    preparedPreferences.travelerName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Companions</dt>
                <dd className="max-w-[60%] text-right text-slate-100">
                  {preparedPreferences.tripCompanions.length
                    ? preparedPreferences.tripCompanions.join(", ")
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Interests</dt>
                <dd className="max-w-[60%] text-right text-slate-100">
                  {preparedPreferences.interests.length
                    ? preparedPreferences.interests.join(", ")
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Tone</dt>
                <dd className="text-slate-100">{toneDisplay}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Pace</dt>
                <dd className="text-slate-100">{paceDisplay}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Accessibility</dt>
                <dd className="max-w-[60%] text-right text-slate-100">
                  {preparedPreferences.accessibilityNotes ?? "—"}
                </dd>
              </div>
            </dl>
            {hasPersonaExtras ? (
              <div className="mt-5 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs text-slate-300">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
                  Persona context
                </h3>
                <dl className="mt-3 space-y-2">
                  {Object.entries(personaExtras).map(([key, value]) => {
                    const readableKey = key
                      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                      .replace(/[-_]+/g, " ");

                    return (
                      <div key={key} className="flex justify-between gap-4">
                        <dt className="text-slate-500">
                          {toTitleCase(readableKey)}
                        </dt>
                        <dd className="max-w-[60%] text-right text-slate-100">
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ) : null}
          </aside>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-xl font-semibold">Story preview</h2>
            {latestStory ? (
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-200">
                {latestStory}
              </p>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                Trigger a narration to preview the full script here.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold">Narration log</h2>
            {narrationLog.length ? (
              <ul className="mt-4 space-y-3 text-xs text-slate-400">
                {narrationLog.map((entry) => (
                  <li
                    key={`${entry.poiId}-${entry.timestamp}`}
                    className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="font-medium text-slate-100">
                        {entry.poiName}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-slate-400">
                      {entry.story}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                Narrations triggered here will appear in a running log.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold">
                Changi Jewel knowledge snapshot
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {knowledge.overview.summary}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-slate-400">
                {overviewBullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
              <span className="uppercase tracking-wide text-slate-500">
                Last verified
              </span>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {knowledge.overview.lastVerified}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Refer to `src/data/changi-jewel/knowledge-base.ts` for full
                context and references.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {quickFactCards.map((fact) => (
              <article
                key={fact.label}
                className="flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-slate-950/60 p-4"
              >
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {fact.category}
                </div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {fact.label}
                </h3>
                <p className="text-xs leading-6 text-slate-400">{fact.value}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                History highlights
              </h3>
              <ol className="mt-3 space-y-3 text-sm text-slate-300">
                {historyHighlights.map((event, index) => (
                  <li
                    key={`${event.title}-${index}`}
                    className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3"
                  >
                    <span className="text-xs uppercase tracking-wide text-emerald-300">
                      Phase {index + 1}
                    </span>
                    <p className="mt-1 font-medium text-slate-100">
                      {event.title}
                    </p>
                    <p className="mt-1 text-xs leading-6 text-slate-400">
                      {event.summary}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Frequent traveller questions
              </h3>
              <dl className="mt-3 space-y-3 text-sm text-slate-300">
                {featuredFaqs.map((faq) => (
                  <div
                    key={faq.question}
                    className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3"
                  >
                    <dt className="font-medium text-slate-100">
                      {faq.question}
                    </dt>
                    <dd className="mt-1 text-xs leading-6 text-slate-400">
                      {faq.answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-50">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">
            Assumptions & tips
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Narrations run entirely on demand—no passive tracking or
              background sensors required.
            </li>
            <li>
              You can plug in additional Changi Jewel experiences by exporting
              more data files and adding them to the `poiCatalog` list.
            </li>
            <li>
              `generateStorytellingForPlaceOfInterest` can be swapped with your
              favourite LLM for richer scripts; the current version is a
              rule-based template.
            </li>
            <li>
              `narrateToUser` will use the browser Speech Synthesis API when
              available, with a console fallback for development.
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-slate-800/60 bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Storytelling is instant—feel free to improvise on the fly.
          </span>
          <span>
            Built for the AI Tour Guide prototype · {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  );
}
