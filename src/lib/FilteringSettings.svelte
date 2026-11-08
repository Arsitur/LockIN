<script lang="ts">
  import Icon from './Icon.svelte';
  import { categoryPolicy, categoryPolicyLocked, type AppState } from './model';
  import type { NetworkGuardStatus } from './storage';
  export let state: AppState;
  export let protectedNow: boolean;
  export let desktop: boolean;
  export let guard: NetworkGuardStatus;
  export let now: number;
  export let change: (
    fn: (s: AppState) => void,
    message?: string,
    record?: boolean,
  ) => Promise<boolean>;
  export let setup: () => void;
  let categoryId = state.categories[0]?.id || '';
  $: policy = categoryPolicy(state, categoryId);
  $: locked = categoryPolicyLocked(state, categoryId, now);
  $: if (!state.categories.some((c) => c.id === categoryId))
    categoryId = state.categories[0]?.id || '';
  let draft = '',
    error = '';
  async function add() {
    const words = draft
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const combined = [...new Set([...policy.blockedKeywords, ...words])];
    if (!words.length) return;
    if (combined.length > 200 || combined.some((w) => w.length > 48)) {
      error = 'Use up to 200 keywords, each up to 48 characters.';
      return;
    }
    if (
      await change(
        (s) =>
          (s.categories.find(
            (c) => c.id === categoryId,
          )!.policy!.blockedKeywords = combined),
        'URL keywords saved',
      )
    ) {
      draft = '';
      error = '';
    }
  }
</script>

<div class="settings-panels">
  <div class="category-policy-picker">
    <label class="field-label" for="filter-category">Category</label><select
      id="filter-category"
      class="select-input"
      bind:value={categoryId}
      >{#each state.categories as c}<option value={c.id}>{c.name}</option
        >{/each}</select
    ><span class="field-hint"
      >{locked
        ? 'Active · settings stay protected until this category unlocks.'
        : 'Configured here · activates only during this category’s timers or schedules.'}</span
    >
  </div>
  <section class="settings-card">
    <div class="settings-card-heading">
      <span class="setting-icon"><Icon name="search" size={21} /></span>
      <div>
        <h3>A boundary for your searches</h3>
        <p>
          Block words anywhere in a website address, including Google searches.
        </p>
      </div>
      <button
        class="toggle"
        class:on={policy.keywordFilterEnabled}
        role="switch"
        aria-checked={policy.keywordFilterEnabled}
        aria-label="Enable URL keyword filter"
        disabled={locked}
        on:click={() =>
          change(
            (s) =>
              (s.categories.find(
                (c) => c.id === categoryId,
              )!.policy!.keywordFilterEnabled = !s.categories.find(
                (c) => c.id === categoryId,
              )!.policy!.keywordFilterEnabled),
            'URL filter updated',
          )}><span></span></button
      >
    </div>
    <div class="keyword-tags">
      {#each policy.blockedKeywords as word}<span
          >{word}<button
            class="icon-button small"
            aria-label={`Remove keyword ${word}`}
            disabled={locked}
            on:click={() =>
              change(
                (s) =>
                  (s.categories.find(
                    (c) => c.id === categoryId,
                  )!.policy!.blockedKeywords = s.categories
                    .find((c) => c.id === categoryId)!
                    .policy!.blockedKeywords.filter((w) => w !== word)),
              )}><Icon name="x" size={12} /></button
          ></span
        >{/each}
    </div>
    <form class="keyword-entry" on:submit|preventDefault={add}>
      <input
        class="text-input"
        aria-label="New URL keywords"
        placeholder="Add words, separated by commas..."
        bind:value={draft}
        disabled={locked}
      /><button type="submit" class="secondary-button" disabled={locked}
        ><Icon name="plus" size={16} />Add words</button
      >
    </form>
    {#if error}<p class="form-error">{error}</p>{/if}
    <p class="field-hint">
      The filter runs only while this category or one of its individual targets
      has an active timer, or its schedule is active. It stops when the last of
      those locks ends. Matching is case insensitive and includes encoded URLs
      and parts of words. For example, “sex” also matches “essex”. Filtering
      needs your connected Chrome companion.
    </p>
  </section>
  <section class="settings-card">
    <div class="settings-card-heading">
      <span class="setting-icon"><Icon name="shield" size={21} /></span>
      <div>
        <h3>Keep the boundary outside Chrome</h3>
        <p>Optional Windows network guard. Requires administrator setup.</p>
      </div>
      <span
        class="connection-label"
        class:connected={guard.running && !guard.error}
        ><span
          class="status-dot"
          class:connected={guard.running && !guard.error}
        ></span>{guard.running
          ? guard.error
            ? 'Needs attention'
            : 'Service ready'
          : guard.installed
            ? 'Not responding'
            : 'Not installed'}</span
      >
    </div>
    <p class="field-hint">
      If the companion disconnects or is removed during strict Lights Out, the
      Windows service blocks all outbound network traffic after the heartbeat
      timeout (about 6 seconds). The block stays until the recorded deadline,
      even if you close LockIN or restart the computer. Strict sessions cannot
      end early. Test mode does not arm new strict locks.
    </p>
    <div class="network-guard-controls">
      <button
        class="secondary-button"
        disabled={!desktop || protectedNow || guard.lockedUntil > now}
        on:click={setup}
        ><Icon name="download" size={16} />{guard.installed
          ? 'Update Windows service'
          : 'Set up Windows service'}</button
      ><label class="strict-switch-label"
        ><span>Strict network protection for this category</span><button
          class="toggle"
          class:on={policy.strictNetworkGuard}
          role="switch"
          aria-checked={policy.strictNetworkGuard}
          aria-label="Enable strict network protection"
          disabled={locked ||
            (!guard.running && !policy.strictNetworkGuard) ||
            (!!guard.error && !policy.strictNetworkGuard)}
          on:click={() =>
            change(
              (s) =>
                (s.categories.find(
                  (c) => c.id === categoryId,
                )!.policy!.strictNetworkGuard = !s.categories.find(
                  (c) => c.id === categoryId,
                )!.policy!.strictNetworkGuard),
              'Strict protection updated',
            )}><span></span></button
        ></label
      >
    </div>
    {#if guard.blocked}<div class="info-banner">
        <Icon name="lock" size={20} />
        <div>
          <strong
            >Network access is locked until {new Date(
              guard.lockedUntil,
            ).toLocaleTimeString('en', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}</strong
          >
          <p>The recorded strict deadline is enforced by Windows.</p>
        </div>
      </div>{/if}{#if guard.error}<p class="form-error">{guard.error}</p>{/if}
    <p class="field-hint">
      An unpacked extension cannot prevent its own removal on an unmanaged
      Chrome installation. This service protects against that simple bypass. An
      administrator can still change Windows services, the firewall, or the
      system clock.
    </p>
  </section>
</div>
