<script lang="ts">
  import {
    siInstagram,
    siX,
    siReddit,
    siTiktok,
    siYoutube,
    siNetflix,
    siTwitch,
  } from 'simple-icons';
  import Icon from './Icon.svelte';
  import type { Site } from './model';
  export let site: Site;
  export let style: 'svg' | 'custom' = 'svg';
  const brands: Record<string, { path: string }> = {
    'instagram.com': siInstagram,
    'x.com': siX,
    'twitter.com': siX,
    'reddit.com': siReddit,
    'tiktok.com': siTiktok,
    'youtube.com': siYoutube,
    'netflix.com': siNetflix,
    'twitch.tv': siTwitch,
  };
  $: brand = brands[site.domain];
</script>

{#if style === 'svg' && brand}<svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    data-site-icon="brand"><path d={brand.path} /></svg
  >{:else}<span data-site-icon="custom"
    ><Icon
      name={style === 'custom'
        ? site.customIcon || 'globe'
        : site.domain === 'amazon.com'
          ? 'bag'
          : 'globe'}
      size={19}
    /></span
  >{/if}
