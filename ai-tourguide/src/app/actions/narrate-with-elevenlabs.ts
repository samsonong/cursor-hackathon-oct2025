"use server";

/**
 * @deprecated This action has been retired in favour of the client-side `narrateToUser`
 * helper, which streams narration directly from ElevenLabs via `/api/narration`.
 * Any new code should call `narrateToUser` instead of invoking this action.
 */
export async function narrateWithElevenLabsAction(): Promise<never> {
  throw new Error(
    "narrateWithElevenLabsAction has been removed. Use narrateToUser on the client instead."
  );
}
