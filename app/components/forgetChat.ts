/**
 * Deleting a chat also forgets it on the server (DELETE /api/chat), so recall cannot
 * find a conversation the user deleted. The sidebar removes the chat only after the
 * server has said so; if the server cannot be reached the chat stays, and the user is
 * told, rather than leaving it in memory unseen.
 */

export const DELETE_CONFIRM = "Delete this chat? minimi will also forget it, so it can't be recalled later.";
export const FORGET_FAILED = "Couldn't delete this chat: minimi's memory could not be reached. Nothing was deleted; try again.";

export async function forgetChatOnServer(
  sessionId: string,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/chat', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
