import { useQuery } from '@tanstack/react-query';
import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';

/**
 * Discord roles in the bot's server, for the role pickers.
 *
 * Fetched only when a picker is on screen and cached hard, like channels: a
 * live call out to Discord for a list that changes about as often as someone
 * makes a role.
 */

export type DiscordRole = {
  id: string;
  name: string;
  /** Discord's colour as an integer; 0 = no colour */
  color: number;
  /** owned by an integration (a bot's own role) - nobody is given it by hand */
  managed?: boolean;
};

export type RoleState = {
  configured: boolean;
  roles: DiscordRole[];
  error?: string;
};

const MOCK: DiscordRole[] = [
  { id: '100', name: 'Server Booster', color: 0xf47fff },
  { id: '101', name: 'VIP', color: 0xf1c40f },
  { id: '102', name: 'Whitelisted', color: 0x2ecc71 },
];

export function useDiscordRoles(enabled = true) {
  return useQuery({
    queryKey: ['discord-roles'],
    enabled,
    queryFn: async (): Promise<RoleState> => {
      if (isEnvBrowser()) return { configured: true, roles: MOCK };
      const reply = await fetchNui<{ success: boolean; data?: RoleState; _error?: string }>(
        'GET_DISCORD_ROLES', {},
      );
      if (!reply?.success) throw new Error(reply?._error ?? 'NoAnswer');
      return reply.data as RoleState;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Discord's integer colour as CSS, or a quiet grey for "no colour". */
export function roleColor(color: number): string {
  return color ? `#${color.toString(16).padStart(6, '0')}` : 'rgba(255,255,255,0.55)';
}
