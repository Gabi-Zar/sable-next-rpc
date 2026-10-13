<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import { UserProfile } from '#lib/profile/user-profile.svelte.js';
  import { useRoomCosmetics } from '#lib/rooms/room-cosmetics.svelte.js';

  import { senderDisplayColors } from './members.js';
  import { hasSenderRoles, useSenderRoles } from './sender-roles';
  import SenderName from './SenderName.svelte';

  interface Props {
    userId: string;
    name: string;
    onProfile?: (userId: string, anchor: HTMLElement) => void;
  }

  let { userId, name, onProfile }: Props = $props();
  const core = useCoreClient();
  const roomCosmetics = useRoomCosmetics();
  const senderRoles = hasSenderRoles() ? useSenderRoles() : null;
  const profile = new UserProfile(core, () => userId);
  let colors = $derived(
    senderDisplayColors(
      userId,
      profile.current,
      null,
      false,
      roomCosmetics?.for(userId) ?? null,
      senderRoles?.(userId)?.color ?? null
    )
  );

  function openProfile(anchor: HTMLElement): void {
    onProfile?.(userId, anchor);
  }
</script>

<SenderName
  displayName={name}
  {colors}
  nameClass="state-subject"
  compact
  profileLabel={$i18n.t('timeline.senderProfile', { name })}
  onProfile={onProfile ? openProfile : undefined}
/>
