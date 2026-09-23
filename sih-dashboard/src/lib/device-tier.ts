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
 * on 'low' - and a wide viewport is never demoted on a memory reading alone,
 * because a browser that clamps that reading to 4 would otherwise hand every
 * desktop the phone's map.
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
  const narrow = window.innerWidth < 768;

  // `cores <= 4 || memory <= 4` demoted desktops. `deviceMemory` is reported
  // in a coarse ladder and clamped for fingerprinting reasons, so 4 is a
  // routine answer from a machine with far more than 4GB - and either signal
  // alone was enough to send a 24-core desktop down the low path, where the
  // station mesh becomes canvas blobs, only the worst nodes keep a label and
  // the wind drops to six streamlines. That is the mobile map, on a desktop.
  //
  // So the two signals now have to agree, and only where a stripped view is
  // plausible in the first place: a narrow viewport. The one exception is a
  // core count so low that nothing will hold a frame at any width.
  if (cores <= 2) return 'low';
  if (narrow && (cores <= 4 || memory <= 4)) return 'low';
  return narrow ? 'mobile' : 'desktop';
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
