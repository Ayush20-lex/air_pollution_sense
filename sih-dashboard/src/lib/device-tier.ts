/**
 * How much work this device can afford per frame.
 *
 * The site's heaviest surfaces - a full-viewport WebGL globe and a page of
 * blurred glass panels sitting over it - cost roughly the same to *describe*
 * on every device and wildly different amounts to *render*. A current phone
 * absorbs them; a 2019 midrange handset does not, and the result is the whole
 * page feeling slow rather than one effect looking cheap.
 *
 * Both signals here are advisory. `deviceMemory` is absent on Safari entirely
 * and clamped to 8 where it exists; `hardwareConcurrency` counts cores without
 * saying how fast they are. So the defaults are deliberately optimistic - a
 * device that reports nothing lands on 'mobile' or 'desktop' by width, never
 * on 'low'. A wrong guess therefore renders a slightly plainer page on a
 * capable device, which is the cheaper mistake than a phone that cannot hold
 * a frame.
 *
 * Read once at startup. These values do not change during a session, and
 * re-reading them on resize would rebuild the scene to chase a constant.
 */
export type DeviceTier = 'low' | 'mobile' | 'desktop';

export function deviceTier(): DeviceTier {
  if (typeof window === 'undefined') return 'mobile';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  if (cores <= 4 || memory <= 4) return 'low';
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

/**
 * Stamps the tier on <html> so CSS can drop effects the GPU cannot afford.
 *
 * An attribute rather than a media query because the expensive cases are not
 * all narrow: an old tablet is a wide viewport on a weak GPU, and a phone in
 * landscape is a wide viewport on a good one. Width alone gets both wrong.
 * The stylesheet still uses width for the purely layout-driven cases.
 */
export function applyDeviceTier(): DeviceTier {
  const tier = deviceTier();
  try {
    document.documentElement.dataset.perf = tier;
  } catch {
    /* non-fatal: the page renders, it just renders the expensive way */
  }
  return tier;
}
