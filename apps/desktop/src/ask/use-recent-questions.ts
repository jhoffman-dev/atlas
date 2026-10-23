import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CHATS_FOLDER, type VaultPath } from '@dfai/domain';
import { recentQuestions, type ChatSummary, type VaultFsPort } from '@dfai/application';
import type { AskRecent } from '@dfai/ui';
import { readAgain, scopedReadKey, scopedReadMeta } from '../reads/query-client.ts';

/** What the recent questions are made from: the notes in `Chats/`. */
const RECENT_SCOPE = { folders: [CHATS_FOLDER] };

/**
 * The questions asked lately (#37), read once and kept (ADR-0040) until the
 * index has news of `Chats/` — or the chat being shown is kept in a new note,
 * which the list should hold before the index has caught up with it.
 */
export function useRecentQuestions({
  fs,
  vault,
  chatPath,
}: {
  fs: VaultFsPort;
  vault: string | null;
  chatPath: VaultPath | null;
}): AskRecent {
  const client = useQueryClient();
  const { data } = useQuery<ChatSummary[]>({
    queryKey: recentKey(vault),
    queryFn: () => recentQuestions({ fs }),
    meta: scopedReadMeta(RECENT_SCOPE),
    enabled: vault !== null,
  });
  useEffect(() => {
    if (chatPath !== null) void readAgain(client, recentKey(vault));
  }, [client, vault, chatPath]);
  return data ?? null;
}

const recentKey = (vault: string | null) => scopedReadKey(vault ?? '', 'recent-questions');
